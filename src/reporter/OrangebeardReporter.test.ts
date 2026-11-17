import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestCase, TestResult, TestStep } from '@playwright/test/reporter';

// Records the order in which the reporter calls the Orangebeard client.
const events: string[] = [];

jest.mock('@orangebeard-io/javascript-client', () => {
  const actual = jest.requireActual('@orangebeard-io/javascript-client');
  let counter = 0;
  const uuid = () => `uuid-${(counter += 1)}`;

  class FakeClient {
    config = { testset: 'testset', description: undefined as string | undefined, attributes: [] as unknown[] };

    startTestRun = jest.fn(() => uuid());

    startSuite = jest.fn((s: { suiteNames: string[] }) => s.suiteNames.map(() => uuid()));

    startTest = jest.fn(() => uuid());

    stepNames: Record<string, string> = {};

    startStep = jest.fn((s: { stepName: string }) => {
      const id = uuid();
      this.stepNames[id] = s.stepName;
      return id;
    });

    log = jest.fn(() => uuid());

    sendAttachment = jest.fn((a: { file: { name: string } }) => {
      events.push(`sendAttachment:${a.file.name}`);
      return uuid();
    });

    finishStep = jest.fn((id: string) => events.push(`finishStep:${this.stepNames[id]}`));

    finishTest = jest.fn(() => events.push('finishTest'));

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

// eslint-disable-next-line import/first
import { OrangebeardReporter } from './OrangebeardReporter';

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
