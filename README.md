<h1 align="center">
  <a href="https://github.com/orangebeard-io/playwright-listener">
    <img src="https://raw.githubusercontent.com/orangebeard-io/playwright-listener/main/.github/logo.svg" alt="Orangebeard.io Playwright Listener" height="200">
  </a>
  <br>Orangebeard.io Playwright Listener<br>
</h1>

<h4 align="center">Orangebeard listener for <a href="https://playwright.dev" target="_blank" rel="noopener">Playwright</a></h4>

<p align="center">
  <a href="https://www.npmjs.com/package/@orangebeard-io/playwright-orangebeard-reporter">
    <img src="https://img.shields.io/npm/v/@orangebeard-io/playwright-orangebeard-reporter.svg?style=flat-square"
      alt="NPM Version" />
  </a>
  <a href="https://github.com/orangebeard-io/playwright-listener/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/orangebeard-io/playwright-listener/release.yml?branch=main&style=flat-square"
      alt="Build Status" />
  </a>
  <a href="https://github.com/orangebeard-io/playwright-listener/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/orangebeard-io/playwright-listener?style=flat-square"
      alt="License" />
  </a>
</p>

<div align="center">
  <h4>
    <a href="https://orangebeard.io">Orangebeard</a> |
    <a href="#installation">Installation</a> |
    <a href="#configuration">Configuration</a>
  </h4>
</div>

## Installation

### Install the npm package

```shell
npm install @orangebeard-io/playwright-orangebeard-reporter
```

## Configuration

Create orangebeard.json (in your test projects's folder (or above))

```JSON
{
  "endpoint": "https://XXX.orangebeard.app",
  "token": "00000000-0000-0000-0000-00000000",
  "project": "my_project_name",
  "testset": "My Test Set Name",
  "description": "A run from playwright",
  "attributes": [
    {
      "key": "SomeKey",
      "value": "SomeValue"
    },
    {
      "value": "Tag value"
    }
  ]
}
```

Configure the reporter in playwright-config.ts:
```ts
export default defineConfig({
    testDir: './my-tests',
    reporter: [['@orangebeard-io/playwright-orangebeard-reporter']],
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        }]
});
```

### Running

Run your tests as usual!

Alternatively, configure Orangebeard variables as ENV (without or on top of orangebeard.json):

```shell
 ORANGEBEARD_ENDPOINT=https://company.orangebeard.app
 ORANGEBEARD_TOKEN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 ORANGEBEARD_PROJECT="my project"
 ORANGEBEARD_TESTSET="my test set"
 ORANGEBEARD_DESCRIPTION="My awesome testrun"
 ORANGEBEARD_ATTRIBUTES="key:value; value;"
 ```
