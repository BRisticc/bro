/** Suffixes that need two labels kept, e.g. "brand.co.uk" not "co.uk". */
const MULTI_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk', 'ltd.uk', 'plc.uk',
    'com.au', 'net.au', 'org.au', 'id.au', 'edu.au', 'gov.au',
    'co.nz', 'net.nz', 'org.nz', 'co.za', 'org.za', 'web.za',
    'com.br', 'net.br', 'org.br', 'com.mx', 'com.ar', 'com.co', 'com.pe',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'or.kr',
    'com.cn', 'net.cn', 'org.cn', 'com.hk', 'com.sg', 'com.my', 'com.tw',
    'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in',
    'com.tr', 'com.ua', 'co.il', 'com.sa', 'com.eg', 'com.ng', 'co.ke',
    'com.es', 'com.pl', 'com.pt', 'com.gr', 'com.ro', 'com.vn', 'co.id', 'co.th',
]);

/** Hosts that are never a brand's own site. */
const DENY_HOSTS = new Set([
    // social / video
    'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'youtube.com', 'youtu.be', 'pinterest.com', 'linkedin.com', 'reddit.com',
    'snapchat.com', 'threads.net', 'threads.com', 'whatsapp.com', 'telegram.me', 't.me',
    'tumblr.com', 'vimeo.com', 'twitch.tv', 'discord.com', 'discord.gg', 'quora.com',
    // marketplaces / retailers (they stock brands, they are not the brand)
    'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au',
    'ebay.com', 'walmart.com', 'target.com', 'costco.com', 'etsy.com',
    'sephora.com', 'ulta.com', 'cvs.com', 'walgreens.com', 'iherb.com',
    'gnc.com', 'vitaminshoppe.com', 'bodybuilding.com', 'chemistwarehouse.com.au',
    'boots.com', 'superdrug.com', 'holandandbarrett.com', 'hollandandbarrett.com',
    'shopify.com', 'myshopify.com', 'bigcommerce.com', 'squarespace.com', 'wix.com',
    // publishers / reference
    'wikipedia.org', 'wikimedia.org', 'nytimes.com', 'forbes.com', 'businessinsider.com',
    'healthline.com', 'webmd.com', 'menshealth.com', 'womenshealthmag.com', 'gq.com',
    'vogue.com', 'allure.com', 'cosmopolitan.com', 'buzzfeed.com', 'medium.com',
    'nih.gov', 'ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'fda.gov', 'mayoclinic.org',
    'consumerreports.org', 'trustpilot.com', 'sitejabber.com', 'yelp.com', 'bbb.org',
    // infra / tooling / trackers
    'google.com', 'googleapis.com', 'gstatic.com', 'doubleclick.net', 'googletagmanager.com',
    'cloudflare.com', 'cloudfront.net', 'akamaihd.net', 'jsdelivr.net', 'unpkg.com',
    'gravatar.com', 'w3.org', 'schema.org', 'apple.com', 'microsoft.com', 'adobe.com',
    'paypal.com', 'stripe.com', 'klarna.com', 'afterpay.com', 'affirm.com',
    'mailchimp.com', 'hubspot.com', 'zendesk.com', 'intercom.com', 'github.com',
    'archive.org', 'bit.ly', 'tinyurl.com', 'linktr.ee',
]);

/** Paths that mean "this is an article about brands", not a brand link. */
const DENY_PATH_PATTERNS = [
    /\/(privacy|terms|cookie|legal|accessibility|sitemap|dmca|disclaimer)/i,
    /\/(login|signin|signup|register|account|cart|checkout|wishlist)/i,
    /\/(author|tag|tags|category|categories|archive|feed|rss|amp)\//i,
    /\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|css|js|xml|ico)$/i,
];

export function normaliseUrl(raw: string, base?: string): string | null {
    try {
        const u = new URL(raw, base);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        u.hash = '';
        // Strip tracking params so the same brand link does not dedupe as two.
        for (const key of [...u.searchParams.keys()]) {
            if (/^(utm_|fbclid|gclid|msclkid|ref|referrer|source|mc_cid|mc_eid|igshid)/i.test(key)) {
                u.searchParams.delete(key);
            }
        }
        return u.toString();
    } catch {
        return null;
    }
}

export function hostOf(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return null;
    }
}

/** "shop.eu.hims.com" -> "hims.com"; "brand.co.uk" -> "brand.co.uk". */
export function registrableDomain(url: string): string | null {
    const host = hostOf(url);
    if (!host || !host.includes('.')) return null;
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
    return lastTwo;
}

export function isDeniedDomain(domain: string, extraDeny: string[] = []): boolean {
    if (DENY_HOSTS.has(domain)) return true;
    for (const d of extraDeny) {
        const clean = d.trim().toLowerCase().replace(/^www\./, '');
        if (clean && (domain === clean || domain.endsWith(`.${clean}`))) return true;
    }
    return false;
}

export function hasDeniedPath(url: string): boolean {
    try {
        const { pathname } = new URL(url);
        return DENY_PATH_PATTERNS.some((re) => re.test(pathname));
    } catch {
        return true;
    }
}

/** "wellnessco.com" -> "Wellnessco"; used only when anchor text is useless. */
export function brandNameFromDomain(domain: string): string {
    const stem = domain.split('.')[0] ?? domain;
    return stem
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

export function sameSite(a: string, b: string): boolean {
    const da = registrableDomain(a);
    const db = registrableDomain(b);
    return da !== null && da === db;
}

export const DENY_HOST_LIST = DENY_HOSTS;
