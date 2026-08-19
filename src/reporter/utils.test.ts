import { getAttachmentFileName } from './utils';

describe('getAttachmentFileName', () => {
  it('uses the basename of attachment.path when a path is present', () => {
    const name = getAttachmentFileName({
      name: 'trace',
      path: '/tmp/playwright-artifacts/abc123/trace.zip',
      contentType: 'application/zip',
    });

    expect(name).toBe('trace.zip');
  });

  it('does not crash for a body-only attachment with no path', () => {
    expect(() =>
      getAttachmentFileName({
        name: 'homepage-screenshot',
        contentType: 'image/png',
      }),
    ).not.toThrow();
  });

  it('appends an extension derived from contentType when the name has none', () => {
    const name = getAttachmentFileName({
      name: 'homepage-screenshot',
      contentType: 'image/png',
    });

    expect(name).toBe('homepage-screenshot.png');
  });

  it('leaves the name untouched when it already has an extension', () => {
    const name = getAttachmentFileName({
      name: 'homepage-screenshot.png',
      contentType: 'image/png',
    });

    expect(name).toBe('homepage-screenshot.png');
  });

  it('falls back to the bare name for an unrecognized content type', () => {
    const name = getAttachmentFileName({
      name: 'custom-data',
      contentType: 'application/x-custom',
    });

    expect(name).toBe('custom-data');
  });
});
