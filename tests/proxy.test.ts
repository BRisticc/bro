import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ProxyConfiguration } from 'apify';
import { PROXY_SESSION_ID_RE, proxySessionId } from '../src/util/proxy.js';

describe('proxy session ids', () => {
    it('replaces the hyphen that crashed the first platform run', () => {
        // "brand-0" reached ProxyConfiguration.newUrl() and threw:
        //   Expected string `sessionId` to match `/^[\w._~]+$/`, got `brand-0`
        assert.equal(proxySessionId('brand-0'), 'brand_0');
        assert.match(proxySessionId('brand-0'), PROXY_SESSION_ID_RE);
    });

    it('leaves an already-legal label alone', () => {
        assert.equal(proxySessionId('source'), 'source');
        assert.equal(proxySessionId('ads'), 'ads');
        assert.equal(proxySessionId('brand_12'), 'brand_12');
    });

    it('normalises anything a label could contain', () => {
        for (const label of [
            'brand-0', 'brand 0', 'https://a.com/x', 'Iron Peak!', 'ürün', '../../etc/passwd',
            'a@b.com', 'tab\there', 'emoji😀', '---', '', '   ',
        ]) {
            const id = proxySessionId(label);
            assert.match(id, PROXY_SESSION_ID_RE, `"${label}" produced an illegal session id "${id}"`);
        }
    });

    it('never returns an empty id', () => {
        assert.equal(proxySessionId(''), 'session');
        assert.equal(proxySessionId('---'), 'session');
    });

    it('caps length so a long label cannot be rejected', () => {
        assert.ok(proxySessionId('x'.repeat(500)).length <= 50);
    });

    // The strongest guard: run the real SDK validation, not a copy of its regex.
    it('is accepted by the actual Apify ProxyConfiguration', async () => {
        const config = new ProxyConfiguration({ proxyUrls: ['http://user:pass@proxy.example:8000'] });

        await assert.rejects(
            async () => config.newUrl('brand-0'),
            /sessionId/,
            'the SDK should still reject a raw hyphenated id — otherwise this test proves nothing',
        );

        for (const label of ['source', 'ads', 'brand-0', 'brand-249', 'Iron Peak!']) {
            const url = await config.newUrl(proxySessionId(label));
            assert.ok(url?.startsWith('http'), `sanitised "${label}" produced no URL`);
        }
    });
});
