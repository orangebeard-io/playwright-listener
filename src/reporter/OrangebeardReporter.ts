import {UUID} from 'crypto';
import {Reporter, TestCase, TestResult, TestStep} from '@playwright/test/reporter'
import {ansiToMarkdown, getBytes, getCodeSnippet, getTime, removeAnsi, testStatusMap} from './utils'
import {OrangebeardParameters} from "@orangebeard-io/javascript-client/dist/client/models/OrangebeardParameters";
import OrangebeardAsyncV3Client from "@orangebeard-io/javascript-client/dist/client/OrangebeardAsyncV3Client";
import {StartTest} from "@orangebeard-io/javascript-client/dist/client/models/StartTest";
import {Attachment} from "@orangebeard-io/javascript-client/dist/client/models/Attachment";
import {Log} from "@orangebeard-io/javascript-client/dist/client/models/Log";
import {Attribute} from "@orangebeard-io/javascript-client/dist/client/models/Attribute";
import {FinishStep} from "@orangebeard-io/javascript-client/dist/client/models/FinishStep";
import TestType = StartTest.TestType;
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
            stepName: step.title,
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

    onTestBegin(test: TestCase): void {
        //check suite
        const suiteUUID = this.getOrStartSuite(test.parent.titlePath())
        const attributes: Array<Attribute> = [];
        for (const tag of test.tags) {
            attributes.push({value: tag})
        }
        const testUUID = this.client.startTest({
            testType: TestType.TEST,
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
        if (result.attachments.length > 0) {
            let message = "";
            for (const attachment of result.attachments) {
                message += `- ${attachment.name} (${attachment.contentType})\n`
            }
            const attachmentsLogUUID = this.client.log({
                logFormat: LogFormat.MARKDOWN,
                logLevel: LogLevel.INFO,
                logTime: getTime(),
                message: message,
                testRunUUID: this.testRunId,
                testUUID: testUUID
            })
            for (const attachment of result.attachments) {
                this.promises.push(this.logAttachment(attachment, testUUID, attachmentsLogUUID));
            }
        }

        //determine status
        const status = testStatusMap[result.status]

        //finish test
        this.client.finishTest(testUUID, {
            testRunUUID: this.testRunId,
            status: status,
            endTime: getTime()
        });
        this.tests.delete(test.id);
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
        this.client.sendAttachment(orangebeardAttachment);
    }
}
