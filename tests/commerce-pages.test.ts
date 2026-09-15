import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildPageInventory, classifyPageKind } from '../src/profile/page-inventory.js';
import { readCheckoutIntel, readProductPage } from '../src/profile/commerce-pages.js';

const PRODUCT_JS = JSON.stringify({
    title: 'Daily Test', price: 4900, compare_at_price: 6900, available: true,
    variants: [{ price: 4900 }, { price: 12900 }],
    options: [{ name: 'Supply' }],
    description: '<p>Clinically dosed testosterone support with tongkat ali.</p>',
    media: [1, 2, 3],
});

const PRODUCT_HTML = `<!doctype html><html><head><title>Daily Test</title>
<script src="https://cdn.rechargepayments.com/rc.js"></script>
<script src="https://rebuyengine.com/r.js"></script>
<script src="https://js.klarna.com/k.js"></script>
</head><body><h1>Daily Test</h1>
<p>$49.00 was $69.00</p>
<p>Subscribe and save 20%. 90-day money-back guarantee. Free shipping.</p>
<p>Rated 4.8 out of 5 from 12,480 reviews. Third-party tested. Cancel anytime.</p>
<p>Buy 3 get 1 free. 3-pack available.</p>
<button>Add to cart</button></body></html>`;

const HOME_HTML = `<!doctype html><html><head>
<script src="https://cdn.rechargepayments.com/rc.js"></script>
<script src="https://js.klarna.com/k.js"></script>
<script src="https://www.paypalobjects.com/p.js"></script>
<script>window.Shopify={};</script>
</head><body class="cart-drawer">
<p>Free shipping on orders over $50</p>
<a href="/cart">Cart</a></body></html>`;

const REFUND_POLICY = `<html><body><h1>Refund policy</h1>
<p>We accept returns within 30 days of delivery for a full refund. Items returned after that
window may be subject to a restocking fee. Please contact support to start a return.
Shipping costs are non-refundable and free shipping applies to orders over $50.</p>
<p>To be eligible for a return your item must be unused and in the same condition that you
received it. It must also be in the original packaging with proof of purchase included.</p></body></html>`;

let server: http.Server;
let origin: string;

before(async () => {
    server = http.createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0];
        const send = (body: string, type = 'text/html'): void => {
            res.writeHead(200, { 'content-type': type });
            res.end(body);
        };
        if (path === '/robots.txt') return send(`User-agent: *\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain');
        if (path === '/sitemap.xml') {
            return send(`<?xml version="1.0"?><sitemapindex xmlns="x">
                <sitemap><loc>${origin}/sitemap_products.xml</loc></sitemap>
                <sitemap><loc>${origin}/sitemap_pages.xml</loc></sitemap>
                <sitemap><loc>https://elsewhere.com/sitemap.xml</loc></sitemap>
            </sitemapindex>`, 'application/xml');
        }
        if (path === '/sitemap_products.xml') {
            return send(`<?xml version="1.0"?><urlset xmlns="x">
                <url><loc>${origin}/products/daily-test</loc></url>
                <url><loc>${origin}/products/sleep-stack</loc></url>
                <url><loc>${origin}/collections/all</loc></url>
            </urlset>`, 'application/xml');
        }
        if (path === '/sitemap_pages.xml') {
            return send(`<?xml version="1.0"?><urlset xmlns="x">
                <url><loc>${origin}/blogs/news/why-men-lose-energy</loc></url>
                <url><loc>${origin}/blogs/news/unadvertised-article</loc></url>
                <url><loc>${origin}/pages/quiz</loc></url>
                <url><loc>${origin}/policies/refund-policy</loc></url>
                <url><loc>${origin}/</loc></url>
            </urlset>`, 'application/xml');
        }
        if (path === '/products/daily-test.js') return send(PRODUCT_JS, 'application/json');
        if (path === '/products/daily-test') return send(PRODUCT_HTML);
        if (path === '/cart.js') return send(JSON.stringify({ currency: 'USD', items: [] }), 'application/json');
        if (path === '/policies/refund-policy') return send(REFUND_POLICY);
        if (path === '/') return send(HOME_HTML);
        res.writeHead(404); res.end('nope');
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
});

const opts = { timeoutSecs: 10, retries: 0 };

describe('page kind classification', () => {
    const cases: Array<[string, string]> = [
        ['https://b.com/products/daily-test', 'product'],
        ['https://b.com/collections/all', 'collection'],
        ['https://b.com/blogs/news/why-x', 'article'],
        ['https://b.com/pages/quiz', 'quiz'],
        ['https://b.com/policies/refund-policy', 'policy'],
        ['https://b.com/cart', 'cart'],
        ['https://b.com/checkouts/abc', 'checkout'],
        ['https://b.com/account/login', 'account'],
        ['https://b.com/', 'home'],
        ['https://b.com/pages/our-story', 'landing'],
    ];
    for (const [url, kind] of cases) {
        it(`reads ${url} as ${kind}`, () => {
            assert.equal(classifyPageKind(url), kind);
        });
    }
});

describe('page inventory from the sitemap', () => {
    it('follows robots.txt into the sitemap index and its children', async () => {
        const inventory = await buildPageInventory(origin, { ...opts, maxSitemaps: 12, maxUrls: 500 });
        assert.equal(inventory.sitemapsRead.length, 3, inventory.sitemapsRead.join(', '));
        assert.equal(inventory.totalUrls, 8);
    });

    it('counts pages by kind', async () => {
        const inventory = await buildPageInventory(origin, { ...opts, maxSitemaps: 12, maxUrls: 500 });
        const byKind = new Map(inventory.counts.map((c) => [c.kind, c.count]));
        assert.equal(byKind.get('product'), 2);
        assert.equal(byKind.get('article'), 2);
        assert.equal(byKind.get('quiz'), 1);
    });

    it('never leaves the brand\'s own domain', async () => {
        const inventory = await buildPageInventory(origin, { ...opts, maxSitemaps: 12, maxUrls: 500 });
        assert.ok(!inventory.sitemapsRead.some((u) => u.includes('elsewhere.com')));
        assert.ok(!Object.values(inventory.samples).flat().some((u) => u?.includes('elsewhere.com')));
    });

    it('reports pages published with no ad spend behind them', async () => {
        const inventory = await buildPageInventory(origin, {
            ...opts, maxSitemaps: 12, maxUrls: 500,
            adDestinations: [`${origin}/blogs/news/why-men-lose-energy`],
        });
        const articles = inventory.unadvertised.find((u) => u.kind === 'article');
        assert.equal(articles?.count, 1, 'one of the two articles has no ads behind it');
        assert.ok(articles?.examples[0]?.includes('unadvertised-article'));
    });

    it('flags ad destinations missing from the sitemap', async () => {
        const inventory = await buildPageInventory(origin, {
            ...opts, maxSitemaps: 12, maxUrls: 500,
            adDestinations: [`${origin}/lp/secret-funnel`],
        });
        assert.ok(inventory.unlistedAdDestinations.some((u) => u.includes('secret-funnel')));
    });

    it('says so when no sitemap can be read', async () => {
        const inventory = await buildPageInventory('http://127.0.0.1:9/', { ...opts, maxSitemaps: 3, maxUrls: 100 });
        assert.equal(inventory.totalUrls, 0);
        assert.match(inventory.notes[0] ?? '', /no readable sitemap/);
    });

    it('flags the URL cap so a count is never read as a total', async () => {
        const inventory = await buildPageInventory(origin, { ...opts, maxSitemaps: 12, maxUrls: 2 });
        assert.match(inventory.notes.join(' '), /cap of 2 reached/);
    });
});

describe('product page intelligence', () => {
    it('reads the real price and discount from the storefront JSON', async () => {
        const intel = await readProductPage(`${origin}/products/daily-test`, opts);
        assert.ok(intel.ok, intel.error);
        assert.equal(intel.title, 'Daily Test');
        assert.equal(intel.price, 49, 'Shopify reports cents');
        assert.equal(intel.compareAtPrice, 69);
        assert.equal(intel.discountPercent, 29);
        assert.equal(intel.variantCount, 2);
        assert.deepEqual(intel.optionNames, ['Supply']);
        assert.equal(intel.available, true);
    });

    it('reads the subscription offer and its discount', async () => {
        const intel = await readProductPage(`${origin}/products/daily-test`, opts);
        assert.equal(intel.subscriptionOffered, true);
        assert.equal(intel.subscriptionDiscountPercent, 20);
    });

    it('reads guarantee, reviews, bundles and trust badges', async () => {
        const intel = await readProductPage(`${origin}/products/daily-test`, opts);
        assert.equal(intel.guaranteeDays, 90);
        assert.equal(intel.reviewCount, 12480);
        assert.equal(intel.reviewRating, 4.8);
        assert.ok(intel.bundleTiers.length > 0, 'a buy-3-get-1 offer should register');
        assert.ok(intel.trustSignals.includes('money-back guarantee'));
        assert.ok(intel.trustSignals.includes('cancel anytime'));
    });

    it('names the conversion apps installed on the page', async () => {
        const intel = await readProductPage(`${origin}/products/daily-test`, opts);
        assert.ok(intel.conversionApps.includes('Recharge'));
        assert.ok(intel.conversionApps.includes('Rebuy'));
        assert.ok(intel.conversionApps.includes('Klarna'));
    });

    it('records a failure instead of throwing', async () => {
        const intel = await readProductPage(`${origin}/products/missing`, opts);
        assert.equal(intel.ok, false);
        assert.match(intel.error ?? '', /404/);
    });
});

describe('cart and checkout intelligence', () => {
    it('reads cart style, currency and the free-shipping bar', async () => {
        const intel = await readCheckoutIntel(origin, opts);
        assert.equal(intel.cartStyle, 'drawer');
        assert.equal(intel.currency, 'USD');
        assert.equal(intel.freeShippingThreshold, 50);
    });

    it('separates payment methods from the rest of the stack', async () => {
        const intel = await readCheckoutIntel(origin, opts);
        assert.ok(intel.paymentMethods.includes('Klarna'));
        assert.ok(intel.paymentMethods.includes('PayPal'));
        assert.deepEqual(intel.bnpl, ['Klarna']);
        assert.ok(intel.checkoutStack.includes('Recharge'));
        assert.ok(!intel.checkoutStack.includes('Klarna'), 'a payment method is not the checkout stack');
    });

    it('reads the real returns window and restocking fee from the policy', async () => {
        const intel = await readCheckoutIntel(origin, opts);
        assert.ok(intel.policiesRead.includes('/policies/refund-policy'));
        assert.equal(intel.returnWindowDays, 30);
        assert.equal(intel.restockingFee, true);
    });

    it('states why the checkout page itself is not fetched', async () => {
        const intel = await readCheckoutIntel(origin, opts);
        assert.match(intel.checkoutNote, /behind a cart/);
        assert.match(intel.checkoutNote, /someone else/);
    });
});
