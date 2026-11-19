// The context hash of Node (HY-125.12): Context computes it with the build as the core does, and gives the same hash
// that PHP and Python give for the same context. The expected values are the `hash` of the cases `plain` and `escaping`
// of contracts/context.json, which the PHP and Python servers check too.
import { describe, expect, it } from 'vitest';
import { Context } from '../src/app/context.js';

const BUILD = '691d41cab78295352a2fea59326d4ac7f4e0a0ff68eb39acb3f09eb0d1eb51ac';

describe('context hash (HY-125.12)', () => {
  it('gives the hash of the contract case plain', () => {
    const text = '{"name":"Board","messages":{"save":"Save"}}';
    expect(Context.hash(BUILD, text)).toBe('55c8f3f2fe7c15b40617b8ce42fe5dc59a6700313f9f1cfb57d9b36070dcef88');
  });

  it('gives the hash of the contract case escaping', () => {
    const text = '{"title":"게시판/Board","css":"/assets/app.css","say":"a \\"b\\" \\\\ c\\n"}';
    expect(Context.hash(BUILD, text)).toBe('88c830a228e2a9052ff3a5cb1a6a03b5ffa7599810832712a9150b2cfcc318ab');
  });
});
