import {ZonedDateTime} from "@js-joda/core";
import {FinishTest} from "@orangebeard-io/javascript-client/dist/client/models/FinishTest";
import * as fs from "node:fs";
import {promisify} from "util";
import Status = FinishTest.Status;
import { StartTest } from '@orangebeard-io/javascript-client/dist/client/models/StartTest';
import TestType = StartTest.TestType;

const stat = promisify(fs.stat);
const access = promisify(fs.access);

export function getTime() {
    return ZonedDateTime.now().withFixedOffsetZone().toString();
}

export const testStatusMap = {
    "passed": Status.PASSED,
    "failed": Status.FAILED,
    "timedOut": Status.TIMED_OUT,
    "skipped": Status.SKIPPED,
    "interrupted": Status.STOPPED
};

export function removeAnsi(ansiString: string): string {
    const parts = ansiString.split(/(\u001b\[[0-9;]*[mG])/);
    let result = "";
    for (const part of parts) {
        if (!part.startsWith("\u001b[")) {
            result += part;
        }
    }
    return result;
}

export function ansiToMarkdown(ansiString: string): string {
    let markdown = "";
    let currentStyle: { italic?: boolean, code?: boolean } = {};

    const ansiCodes = {
        "31": {italic: true},
        "32": {italic: true},
        "39": {italic: false}, // Reset styles
        "2": {code: true},
        "22": {code: false},
    };

    const parts = ansiString.split(/(\u001b\[[0-9;]*[mG])/);

    for (const part of parts) {
        if (part.startsWith("\u001b[")) {
            const code = part.slice(2, -1);
            const codes = code.split(';');
            for (const c of codes) {
                const style = ansiCodes[c as keyof typeof ansiCodes]; // Type guard
                if (style) {
                    currentStyle = {...currentStyle, ...style};
                }
            }
        } else {
            let formattedPart = part.replace(/\n/g, "  \n");

            if (currentStyle.italic) {
                formattedPart = formattedPart.endsWith(" ") ? `*${formattedPart.trim()}* ` : `*${formattedPart}*`;

            }
            if (currentStyle.code) {
                formattedPart = `${formattedPart}`;
            }

            markdown += formattedPart

        }
    }

    return markdown;
}

/**
 * Reads a 3-line snippet from a file, centered around the specified line number.
 *
 * @param filePath - The path to the file.
 * @param lineNumber - The line number to center the snippet around (1-based index).
 * @returns A promise that resolves with the 3-line snippet or an error message if the line is out of range.
 */
export /**
 * Reads a 3-line snippet from a file, centered around the specified line number.
 *
 * @param filePath - The path to the file.
 * @param lineNumber - The line number to center the snippet around (1-based index).
 * @returns The 3-line snippet or an error message if the line is out of range.
 */
function getCodeSnippet(filePath: string, lineNumber: number): string {
    if (lineNumber < 1) {
        throw new Error('Line number must be 1 or greater.');
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split(/\r?\n/); // Support both Unix and Windows line endings

    const startLine = Math.max(0, lineNumber - 2); // Zero-based index for one line before
    const endLine = Math.min(lines.length, lineNumber + 1); // One line after

    if (startLine >= lines.length) {
        throw new Error('Line number is out of range.');
    }

    let snippet = lines.slice(startLine, endLine);
    if (snippet.length > 0 && snippet[0].trim() === "") {
        snippet = snippet.slice(1);
    }

    return `\`\`\`js\n${snippet.join('\n')}\n\`\`\``;
}

const fileExists = async (filepath: string) => {
    try {
        await access(filepath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
};

const waitForFile = async (filepath: string, interval = 1000, timeout = 60000) => {
    const start = Date.now();

    while (true) {
        const now = Date.now();
        if (now - start > timeout) {
            throw new Error(`Timeout: ${filepath} did not become available within ${timeout}ms`);
        }

        if (await fileExists(filepath)) {
            const stats = [];
            for (let i = 0; i < 2; i++) {
                stats.push(await stat(filepath));
                await new Promise((resolve) => setTimeout(resolve, interval));
            }

            const [first, second] = stats;
            if (
                first.mtimeMs === second.mtimeMs &&
                first.size === second.size
            ) {
                return;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
    }
};

export const getBytes = async (filePath: string) => {
    try {
        await waitForFile(filePath, 100, 5000)
        return fs.readFileSync(filePath);
    } catch (err) {
        console.error('Error reading file:', err);
        throw err;
    }
};

export function getAttachmentKey(attachment: {
    name: string,
    path?: string,
    body?: Buffer,
    contentType: string
}): string {
    const size = attachment.body ? attachment.body.byteLength : undefined;
    const pathOrSize = attachment.path ?? size ?? 'no-path-no-size';
    return `${attachment.name}|${attachment.contentType}|${pathOrSize}`;
}

export function determineTestType(parentTitlePath: string): TestType {
    const lower = parentTitlePath.toLowerCase();
    if (lower.includes('beforeall') || lower.includes('before all')) {
        return TestType.BEFORE;
    }

    if (lower.includes('afterall') || lower.includes('after all')) {
        return TestType.AFTER;
    }

    if (lower.includes('setup')) {
        return TestType.BEFORE;
    }

    if (lower.includes('teardown')) {
        return TestType.AFTER;
    }

    return TestType.TEST;
}

