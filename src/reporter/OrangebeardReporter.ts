import {UUID} from 'crypto';
import {Reporter, TestCase, TestResult, TestStep} from '@playwright/test/reporter'
import {
    ansiToMarkdown,
    determineTestType,
    getAttachmentKey,
    getBytes,
    getCodeSnippet,
    getTime,
    removeAnsi,
    testStatusMap,
} from './utils';
import {OrangebeardParameters} from "@orangebeard-io/javascript-client/dist/client/models/OrangebeardParameters";
import OrangebeardAsyncV3Client from "@orangebeard-io/javascript-client/dist/client/OrangebeardAsyncV3Client";
import {Attachment} from "@orangebeard-io/javascript-client/dist/client/models/Attachment";
import {Log} from "@orangebeard-io/javascript-client/dist/client/models/Log";
import {Attribute} from "@orangebeard-io/javascript-client/dist/client/models/Attribute";
import {FinishStep} from "@orangebeard-io/javascript-client/dist/client/models/FinishStep";
import LogFormat = Log.LogFormat;
import LogLevel = Log.LogLevel;
import Status = FinishStep.Status;
import * as path from "node:path";

export class OrangebeardReporter implements Reporter {

    config: OrangebeardParameters;
    client: OrangebeardAsyncV3Client;

    //CONTEXT TRACKING
    testRunId: UUID;
    suites: Map<string, UUID> = new Map<string, UUID>(); //suiteNames , uuid
    tests: Map<string, UUID> = new Map<string, UUID>(); //testId, uuid
    steps: Map<string, UUID> = new Map<string, UUID>(); //testId_stepPath, uuid
    promises: Promise<void>[] = [];
    processedStepAttachments: Map<string, Set<string>> = new Map<string, Set<string>>(); // testId -> set of attachment keys already uploaded on step level

    constructor() {
        this.client = new OrangebeardAsyncV3Client();
        this.config = this.client.config;
    }

    onBegin(): void {
        this.testRunId = this.client.startTestRun({
            testSetName: this.config.testset,
            description: this.config.description,
            startTime: getTime(),
            attributes: this.config.attributes
        })
    }

    async onEnd(): Promise<void> {
        await Promise.all(this.promises)
        return this.client.finishTestRun(this.testRunId, {endTime: getTime()})
    }

    onStdErr(chunk: string | Buffer, test: void | TestCase, _result: void | TestResult): void {
        //log error level

        if (typeof test === 'object' && test !== null) {
            const testUUID = this.tests.get(test.id);
            const message = chunk.toString();
            this.client.log({
                logFormat: LogFormat.PLAIN_TEXT,
                logLevel: LogLevel.ERROR,
                logTime: getTime(),
                message: message,
                testRunUUID: this.testRunId,
                testUUID: testUUID
            });
        }
    }

    onStdOut(chunk: string | Buffer, test: void | TestCase, _result: void | TestResult): void {
        if (typeof test === 'object' && test !== null) {
            const testUUID = this.tests.get(test.id);
            const message = chunk.toString();
            this.client.log({
                logFormat: LogFormat.PLAIN_TEXT,
                logLevel: LogLevel.INFO,
                logTime: getTime(),
                message: message,
                testRunUUID: this.testRunId,
                testUUID: testUUID
            });
        }
    }

    onStepBegin(test: TestCase, _result: TestResult, step: TestStep): void {
        //start step
        const testUUID = this.tests.get(test.id);

        const stepUUID = this.client.startStep({
            startTime: getTime(),
            stepName: step.title || step.titlePath().toString() || 'Untitled step',
            description: step.location ? `${path.basename(step.location.file)}:${step.location.line}`: undefined,
            testRunUUID: this.testRunId,
            testUUID: testUUID,
            parentStepUUID: step.parent ? this.steps.get(test.id + "|" + step.parent.titlePath()) : undefined,
        })
        this.steps.set(test.id + "|" + step.titlePath(), stepUUID)

        if(step.location) {
            this.client.log({
                logFormat: LogFormat.MARKDOWN,
                logLevel: LogLevel.INFO,
                logTime: getTime(),
                message: getCodeSnippet(step.location.file, step.location.line),
                testRunUUID: this.testRunId,
                testUUID: testUUID,
                stepUUID: stepUUID
            });
        }
    }

    onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
        const testUUID = this.tests.get(test.id);
        const stepUUID = this.steps.get(test.id + "|" + step.titlePath())

        // Handle step-level attachments (similar to test-level attachments in onTestEnd)
        if (step.attachments && step.attachments.length > 0 && stepUUID) {
            let message = "";
            for (const attachment of step.attachments) {
                message += `- ${attachment.name} (${attachment.contentType})\\n`;
            }

            const attachmentsLogUUID = this.client.log({
                logFormat: LogFormat.MARKDOWN,
                logLevel: LogLevel.INFO,
                logTime: getTime(),
                message: message,
                testRunUUID: this.testRunId,
                testUUID: testUUID,
                stepUUID: stepUUID,
            });

            for (const attachment of step.attachments) {
                // Track that this attachment has already been uploaded on the step level,
                // so we can skip it when handling test-level attachments in onTestEnd.
                const key = getAttachmentKey(attachment);
                let processedForTest = this.processedStepAttachments.get(test.id);
                if (!processedForTest) {
                    processedForTest = new Set<string>();
                    this.processedStepAttachments.set(test.id, processedForTest);
                }
                processedForTest.add(key);

                this.promises.push(this.logAttachment(attachment, testUUID, attachmentsLogUUID));
            }
        }

        if(step.error) {
            const message = step.error.message;
            this.client.log({
                logFormat: LogFormat.MARKDOWN,
                logLevel: LogLevel.ERROR,
                logTime: getTime(),
                message: ansiToMarkdown(message),
                testRunUUID: this.testRunId,
                testUUID: testUUID,
                stepUUID: stepUUID
            });

            if (step.error.snippet) {
                this.client.log({
                    logFormat: LogFormat.MARKDOWN,
                    logLevel: LogLevel.ERROR,
                    logTime: getTime(),
                    message: `\`\`\`js\n${removeAnsi(step.error.snippet)}\n\`\`\``,
                    testRunUUID: this.testRunId,
                    testUUID: testUUID,
                    stepUUID: stepUUID
                });
            }
        }

        this.client.finishStep(this.steps.get(test.id + "|" + step.titlePath()), {
            endTime: getTime(),
            status: step.error ? Status.FAILED : Status.PASSED,
            testRunUUID: this.testRunId
        })
        this.steps.delete(test.id + "|" + step.titlePath())
    }

    onTestBegin(test: TestCase, result: TestResult): void {
        //check suite
        const suiteUUID = this.getOrStartSuite(test.parent.titlePath())
        const attributes: Array<Attribute> = [];

        // Tags -> attributes without key
        for (const tag of test.tags) {
            attributes.push({value: tag})
        }

        // Annotations -> structured attributes
        for (const annotation of test.annotations) {
            const description = annotation.description?.trim();
            switch (annotation.type) {
                case 'issue':
                case 'bug':
                    if (description) {
                        attributes.push({key: 'Issue', value: description});
                    }
                    break;
                case 'tag':
                    if (description) {
                        attributes.push({value: description});
                    }
                    break;
                case 'skip':
                case 'slow':
                case 'fixme':
                case 'fail': {
                    const value = description && description.length > 0 ? description : annotation.type;
                    attributes.push({key: 'PlaywrightAnnotation', value: value});
                    if (annotation.type === 'fail') {
                        // Mark tests annotated as expected-to-fail
                        attributes.push({key: 'ExpectedStatus', value: 'failed'});
                        attributes.push({key: 'ExpectedToFail', value: 'true'});
                    }
                    break;
                }
                default:
                    if (description && description.length > 0) {
                        attributes.push({key: `annotation:${annotation.type}`, value: description});
                    } else {
                        attributes.push({value: `annotation:${annotation.type}`});
                    }
            }
        }

        // If this is a retry attempt (retry index > 0), add a Retry attribute
        if (typeof result?.retry === 'number' && result.retry > 0) {
            attributes.push({key: 'Retry', value: result.retry.toString()});
        }

        const testType = determineTestType(test.parent.titlePath().join('>'))

        const testUUID = this.client.startTest({
            testType: testType,
            testRunUUID: this.testRunId,
            suiteUUID: suiteUUID,
            testName: test.title,
            startTime: getTime(),
            description: this.getTestDescription(test),
            attributes: attributes
        });
        this.tests.set(test.id, testUUID);
    }

    async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
        const testUUID = this.tests.get(test.id);

        // Filter out attachments that were already handled at step level to avoid duplicates.
        const processedForTest = this.processedStepAttachments.get(test.id);
        const remainingAttachments = processedForTest
            ? result.attachments.filter((attachment) => !processedForTest!.has(getAttachmentKey(attachment)))
            : result.attachments;

        if (remainingAttachments.length > 0) {
            let message = "";
            for (const attachment of remainingAttachments) {
                message += `- ${attachment.name} (${attachment.contentType})\\n`
            }
            const attachmentsLogUUID = this.client.log({
                logFormat: LogFormat.MARKDOWN,
                logLevel: LogLevel.INFO,
                logTime: getTime(),
                message: message,
                testRunUUID: this.testRunId,
                testUUID: testUUID
            })
            for (const attachment of remainingAttachments) {
                this.promises.push(this.logAttachment(attachment, testUUID, attachmentsLogUUID));
            }
        }

        // Log test-level errors that are not tied to specific steps (e.g. hooks/fixtures)
        const errors = (result as any).errors && (result as any).errors.length > 0
            ? (result as any).errors
            : (result.error ? [result.error] : []);

        if (errors && errors.length > 0) {
            let errorMessage = '';
            for (let index = 0; index < errors.length; index += 1) {
                const err = errors[index];
                if (index > 0) {
                    errorMessage += '\n\n';
                }
                if (err.message) {
                    errorMessage += `**Error:** ${ansiToMarkdown(err.message)}\n`;
                }
                if (err.stack) {
                    errorMessage += `\`\`\`\n${removeAnsi(err.stack)}\n\`\`\``;
                }
            }

            if (errorMessage.length > 0) {
                this.client.log({
                    logFormat: LogFormat.MARKDOWN,
                    logLevel: LogLevel.ERROR,
                    logTime: getTime(),
                    message: errorMessage,
                    testRunUUID: this.testRunId,
                    testUUID: testUUID,
                });
            }
        }

        //determine status
        const status = testStatusMap[result.status]

        // If the test passed after one or more retries, mark it as flaky in the logs
        if (typeof result.retry === 'number' && result.retry > 0 && status === Status.PASSED) {
            this.client.log({
                logFormat: LogFormat.PLAIN_TEXT,
                logLevel: LogLevel.INFO,
                logTime: getTime(),
                message: `Test passed after ${result.retry} retr${result.retry === 1 ? 'y' : 'ies'}`,
                testRunUUID: this.testRunId,
                testUUID: testUUID,
            });
        }

        //finish test
        this.client.finishTest(testUUID, {
            testRunUUID: this.testRunId,
            status: status,
            endTime: getTime()
        });
        this.tests.delete(test.id);
        this.processedStepAttachments.delete(test.id);
    }

    printsToStdio(): boolean {
        return false;
    }

    private getOrStartSuite(suitePath: Array<string>): UUID {
        const filteredSuitePath = suitePath.filter(name => name !== "");
        let currentPath: Array<string> = [];
        let parentSuiteUUID: UUID | undefined = undefined;

        for (const suiteName of filteredSuitePath) {
            currentPath.push(suiteName);
            const existingSuiteUUID = this.suites.get(currentPath.join('|'));

            if (existingSuiteUUID) {
                parentSuiteUUID = existingSuiteUUID;
            } else {
                const newSuitesUUIDs = this.client.startSuite({
                    testRunUUID: this.testRunId,
                    parentSuiteUUID: parentSuiteUUID,
                    suiteNames: [suiteName],
                });

                if (newSuitesUUIDs && newSuitesUUIDs.length > 0) {
                    parentSuiteUUID = newSuitesUUIDs[0];
                    this.suites.set(currentPath.join('|'), parentSuiteUUID);
                } else {
                    console.error(`Failed to create suite for path: ${currentPath.join(' > ')}`);
                }
            }
        }
        return parentSuiteUUID as UUID;
    }

    private getTestDescription(test: TestCase): string {
        let description = `${path.basename(test.location.file)}:${test.location.line}\n`;
        for (const annotation of test.annotations) {
            description = `${description + annotation.type}: ${annotation.description}\n`
        }
        return description;
    }

    private async logAttachment(attachment: {
        name: string,
        path?: string,
        body?: Buffer,
        contentType: string
    }, testUUID: UUID, logUUID: UUID) {
        try {
            let content: Buffer;
            if (attachment.body) {
                content = attachment.body;
            } else if (attachment.path) {
                content = await getBytes(attachment.path);
            } else {
                throw new Error("Attachment must have either body or path defined.");
            }

            const orangebeardAttachment: Attachment = {
                file: {
                    name: path.basename(attachment.path),
                    content: content,
                    contentType: attachment.contentType,
                },
                metaData: {
                    testRunUUID: this.testRunId,
                    testUUID: testUUID,
                    logUUID: logUUID,
                    attachmentTime: getTime()
                },
            };
            await this.client.sendAttachment(orangebeardAttachment);
        } catch (err) {
            // Avoid failing the entire test run due to a single attachment failure.
            // Log to stderr so issues are visible during test execution.
            // eslint-disable-next-line no-console
            console.error('Error sending attachment to Orangebeard:', err);
        }
    }
}
