import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestCase, TestResult, TestStep } from '@playwright/test/reporter';

// Records the order in which the reporter calls the Orangebeard client.
const events: string[] = [];
// Test knobs for the fake client below.
const mockClientBehaviour = { uploadDelayMs: 0, failFinishTest: false };

jest.mock('@orangebeard-io/javascript-client', () => {
  const actual = jest.requireActual('@orangebeard-io/javascript-client');
  let counter = 0;
  const uuid = () => `uuid-${(counter += 1)}`;

  class FakeClient {
    config = {
      testset: 'testset',
      description: undefined as string | undefined,
      attributes: [] as unknown[],
    };

    startTestRun = jest.fn(() => uuid());

    startSuite = jest.fn((s: { suiteNames: string[] }) => s.suiteNames.map(() => uuid()));

    startTest = jest.fn(() => uuid());

    stepNames: Record<string, string> = {};

    startStep = jest.fn((s: { stepName: string }) => {
      const id = uuid();
      this.stepNames[id] = s.stepName;
      return id;
    });

    log = jest.fn<string, [{ message: string }]>(() => uuid());

    // like the real client: one promise per pending request, settled when it was sent
    promises: Record<string, Promise<unknown>> = {};

    sendAttachment = jest.fn((a: { file: { name: string } }) => {
      events.push(`sendAttachment:${a.file.name}`);
      const id = uuid();
      this.promises[id] = new Promise((resolve) => {
        setTimeout(resolve, mockClientBehaviour.uploadDelayMs);
      });
      return id;
    });

    finishStep = jest.fn((id: string) => events.push(`finishStep:${this.stepNames[id]}`));

    finishTest = jest.fn(() => {
      if (mockClientBehaviour.failFinishTest) {
        throw new Error('finishTest failed');
      }
      events.push('finishTest');
    });

    finishTestRun = jest.fn(async () => {
      events.push('finishTestRun');
    });
  }

  return {
    __esModule: true,
    default: FakeClient,
    FinishStep: actual.FinishStep,
    FinishTest: actual.FinishTest,
    Log: actual.Log,
    StartTest: actual.StartTest,
  };
});

// imported after jest.mock above (jest hoists the mock, this keeps the order explicit)
import { OrangebeardReporter } from './OrangebeardReporter';
import * as utils from './utils';

beforeEach(() => {
  mockClientBehaviour.uploadDelayMs = 0;
  mockClientBehaviour.failFinishTest = false;
});

const passedResult = (attachments: unknown[] = []) =>
  ({ retry: 0, status: 'passed', attachments, errors: [] }) as unknown as TestResult;

const aTestCase = (annotations: { type: string; description?: string }[] = []) =>
  ({
    id: 'test-1',
    title: 'a test',
    parent: { titlePath: () => ['', 'chromium', 'example.spec.ts'] },
    tags: [],
    annotations,
    location: { file: '/project/example.spec.ts', line: 3, column: 1 },
  }) as unknown as TestCase;

const aStep = (title: string, parent?: TestStep) =>
  ({
    title,
    titlePath: () => [...(parent ? parent.titlePath() : []), title],
    parent,
    attachments: [],
  }) as unknown as TestStep;

const fakeClient = (reporter: OrangebeardReporter) => reporter.client as any;

describe('OrangebeardReporter step tracking', () => {
  it('tracks steps with the same title running in parallel separately', async () => {
    const reporter = new OrangebeardReporter();
    const test = aTestCase();
    const result = passedResult();
    const first = aStep('expect.toBeVisible');
    const second = aStep('expect.toBeVisible');

    reporter.onBegin();
    reporter.onTestBegin(test, result);
    reporter.onStepBegin(test, result, first);
    reporter.onStepBegin(test, result, second);
    reporter.onStepEnd(test, result, first);
    reporter.onStepEnd(test, result, second);
    await reporter.onEnd();

    const client = fakeClient(reporter);
    const started = client.startStep.mock.results.map((r: { value: string }) => r.value);
    const finished = client.finishStep.mock.calls.map((call: unknown[]) => call[0]);
    expect(finished).toEqual(started);
  });

  it('starts a child step under its own parent when parents share a title', () => {
    const reporter = new OrangebeardReporter();
    const test = aTestCase();
    const result = passedResult();
    const firstParent = aStep('retry block');
    const secondParent = aStep('retry block');
    const child = aStep('click', firstParent);

    reporter.onBegin();
    reporter.onTestBegin(test, result);
    reporter.onStepBegin(test, result, firstParent);
    reporter.onStepBegin(test, result, secondParent);
    reporter.onStepBegin(test, result, child);

    const client = fakeClient(reporter);
    const firstParentUUID = client.startStep.mock.results[0].value;
    expect(client.startStep.mock.calls[2][0].parentStepUUID).toEqual(firstParentUUID);
  });
});

describe('OrangebeardReporter log content', () => {
  it('lists attachments on separate lines', async () => {
    const reporter = new OrangebeardReporter();
    const test = aTestCase();
    const result = passedResult([
      { name: 'one', body: Buffer.from('1'), contentType: 'text/plain' },
      { name: 'two', body: Buffer.from('2'), contentType: 'text/plain' },
    ]);

    reporter.onBegin();
    reporter.onTestBegin(test, result);
    await reporter.onTestEnd(test, result);
    await reporter.onEnd();

    const messages: string[] = fakeClient(reporter).log.mock.calls.map(
      (call: [{ message: string }]) => call[0].message,
    );
    const list = messages.find((m) => m.startsWith('- one'));
    expect(list).toBe('- one (text/plain)\n- two (text/plain)\n');
  });

  it('does not write "undefined" for annotations without a description', () => {
    const reporter = new OrangebeardReporter();
    const test = aTestCase([{ type: 'slow' }, { type: 'issue', description: 'ABC-1' }]);

    reporter.onBegin();
    reporter.onTestBegin(test, passedResult());

    const { description } = fakeClient(reporter).startTest.mock.calls[0][0];
    expect(description).toBe('example.spec.ts:3\nslow\nissue: ABC-1\n');
  });
});

describe('OrangebeardReporter attachment memory', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps only a few file attachments in memory until they are uploaded', async () => {
    mockClientBehaviour.uploadDelayMs = 30;
    const inMemory = { current: 0, max: 0 };
    jest.spyOn(utils, 'getBytes').mockImplementation(async () => {
      inMemory.current += 1;
      inMemory.max = Math.max(inMemory.max, inMemory.current);
      return Buffer.from('content');
    });
    const reporter = new OrangebeardReporter();
    const client = fakeClient(reporter);
    client.sendAttachment.mockImplementation(() => {
      const id = `attachment-${client.sendAttachment.mock.calls.length}`;
      client.promises[id] = new Promise((resolve) => {
        setTimeout(() => {
          inMemory.current -= 1;
          resolve(undefined);
        }, mockClientBehaviour.uploadDelayMs);
      });
      return id;
    });
    const attachments = Array.from({ length: 8 }, (_, i) => ({
      name: `video-${i}`,
      path: `/results/video-${i}.webm`,
      contentType: 'video/webm',
    }));
    const test = aTestCase();
    const result = passedResult(attachments);

    reporter.onBegin();
    reporter.onTestBegin(test, result);
    await reporter.onTestEnd(test, result);
    await reporter.onEnd();

    expect(client.sendAttachment).toHaveBeenCalledTimes(8);
    expect(inMemory.max).toBeGreaterThan(1);
    expect(inMemory.max).toBeLessThanOrEqual(OrangebeardReporter.MAX_FILE_ATTACHMENTS_IN_MEMORY);
  });
});

describe('OrangebeardReporter finishing the run', () => {
  it('finishes the run even when a deferred finish fails', async () => {
    mockClientBehaviour.failFinishTest = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = new OrangebeardReporter();
    const test = aTestCase();
    const result = passedResult([
      { name: 'note', body: Buffer.from('n'), contentType: 'text/plain' },
    ]);

    reporter.onBegin();
    reporter.onTestBegin(test, result);
    await reporter.onTestEnd(test, result);
    await expect(reporter.onEnd()).resolves.toBeUndefined();

    expect(fakeClient(reporter).finishTestRun).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});

describe('OrangebeardReporter attachment ordering', () => {
  let dir: string;
  let attachmentPath: string;

  beforeEach(() => {
    events.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-reporter-'));
    attachmentPath = path.join(dir, 'trace.zip');
    fs.writeFileSync(attachmentPath, 'trace-content');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const testCase = {
    id: 'test-1',
    title: 'a test',
    parent: { titlePath: () => ['', 'chromium', 'example.spec.ts'] },
    tags: [],
    annotations: [],
    location: { file: '/project/example.spec.ts', line: 3, column: 1 },
  } as unknown as TestCase;

  const fileAttachment = () => ({
    name: 'trace',
    path: attachmentPath,
    contentType: 'application/zip',
  });

  it('sends file attachments of a test before finishing the test', async () => {
    const reporter = new OrangebeardReporter();
    const result = {
      retry: 0,
      status: 'failed',
      attachments: [fileAttachment()],
      errors: [],
    } as unknown as TestResult;

    reporter.onBegin();
    reporter.onTestBegin(testCase, result);
    await reporter.onTestEnd(testCase, result);
    await reporter.onEnd();

    expect(events).toEqual(['sendAttachment:trace.zip', 'finishTest', 'finishTestRun']);
  });

  it('sends file attachments of a step before finishing the step', async () => {
    const reporter = new OrangebeardReporter();
    const result = {
      retry: 0,
      status: 'passed',
      attachments: [],
      errors: [],
    } as unknown as TestResult;
    const step = {
      title: 'a step',
      titlePath: () => ['a step'],
      attachments: [fileAttachment()],
    } as unknown as TestStep;

    reporter.onBegin();
    reporter.onTestBegin(testCase, result);
    reporter.onStepBegin(testCase, result, step);
    reporter.onStepEnd(testCase, result, step);
    await reporter.onTestEnd(testCase, result);
    await reporter.onEnd();

    expect(events).toEqual([
      'sendAttachment:trace.zip',
      'finishStep:a step',
      'finishTest',
      'finishTestRun',
    ]);
  });

  it('finishes a parent step only after a deferred finish of its child step', async () => {
    const reporter = new OrangebeardReporter();
    const result = {
      retry: 0,
      status: 'passed',
      attachments: [],
      errors: [],
    } as unknown as TestResult;
    const parent = {
      title: 'parent',
      titlePath: () => ['parent'],
      attachments: [],
    } as unknown as TestStep;
    const child = {
      title: 'child',
      titlePath: () => ['parent', 'child'],
      parent,
      attachments: [fileAttachment()],
    } as unknown as TestStep;

    reporter.onBegin();
    reporter.onTestBegin(testCase, result);
    reporter.onStepBegin(testCase, result, parent);
    reporter.onStepBegin(testCase, result, child);
    reporter.onStepEnd(testCase, result, child);
    reporter.onStepEnd(testCase, result, parent);
    await reporter.onTestEnd(testCase, result);
    await reporter.onEnd();

    expect(events).toEqual([
      'sendAttachment:trace.zip',
      'finishStep:child',
      'finishStep:parent',
      'finishTest',
      'finishTestRun',
    ]);
  });
});
