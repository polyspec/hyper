// The assets of a template release and of the json release whose extension the template extension requires, which
// the tests of the template pins name. The json release is the version that the platform of the root composer.json
// declares for ext-polyspec_json, whose Composer repository both Composer roots declare (HY-48.15).
import { readFileSync } from 'node:fs';
import { jsonObject, jsonString, parseJsonObject } from '../../scripts/json.mts';

const root = parseJsonObject(readFileSync('composer.json', 'utf8'), 'composer.json');
const platform = jsonObject(jsonObject(root.config, 'composer.json config').platform, 'composer.json platform');

export const JSON_VERSION = jsonString(platform['ext-polyspec_json'], 'composer.json platform ext-polyspec_json');
export const JSON_PACKAGES = `https://github.com/polyspec/json/releases/download/v${JSON_VERSION}/packages.json`;
// The package @polyspec/template and its platform packages, which hold the native module of the napi root.
export const NPM_PACKAGE = '@polyspec/template';
export const NPM_PLATFORMS = ['@polyspec/template-darwin-arm64', '@polyspec/template-linux-arm64-gnu', '@polyspec/template-linux-x64-gnu'];

/** The download URL of the assets of the template release `version`. */
export const releaseOf = (version: string): string => `https://github.com/polyspec/template/releases/download/v${version}`;

/** The tarball asset of the npm package `name` of the template release `version`. */
export const tarballOf = (version: string, name: string): string => `${releaseOf(version)}/${name.slice(1).replace('/', '-')}-${version}.tgz`;
