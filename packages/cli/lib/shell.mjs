// The static shell of client rendering (HY-62, HYC-16): one HTML file with the data base path, the build id and the
// URL of the entry that it inlines, and no stylesheet. `hyper build` passes the id that it computed (HY-125.21); a test
// that needs a fixed id writes its shell with the same function and that id.

/** Returns the text of the shell for the data base path `api`, the build id `build` and the client entry `entry`. */
export function shellText({ api, build, entry }) {
  if (/<\/script/i.test(entry.code)) throw new Error('the client entry contains </script and cannot be inlined');
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="hyper-api" content="${api}">`,
    `<meta name="hyper-build" content="${build}">`,
    // The inlined entry has no address, so the shell declares the one that the manifest gives the layout (HYC-16, HYC-25).
    `<meta name="hyper-entry" content="${entry.url}">`,
    '<title></title>',
    `<script type="module">${entry.code}</script>`,
    '</head>',
    '<body></body>',
    '</html>',
    '',
  ].join('\n');
}
