/**
 * Marketing/commerce stack detection from HTML we have already fetched.
 *
 * This is the highest signal-per-byte thing on a brand's page. A Meta pixel
 * plus a TikTok pixel says the brand buys paid media; Klaviyo says it runs
 * lifecycle email; Recharge says subscription is a real part of the model;
 * Okendo or Loox says it invests in review collection. None of that is
 * claimed anywhere in the copy, and all of it is comparable across brands.
 */

export type StackCategory =
    | 'analytics' | 'adPixel' | 'email' | 'sms' | 'subscription' | 'reviews'
    | 'cro' | 'support' | 'payments' | 'affiliate' | 'personalisation';

interface Fingerprint {
    name: string;
    category: StackCategory;
    re: RegExp;
}

const FINGERPRINTS: Fingerprint[] = [
    // Ad pixels — the clearest "this brand buys traffic" signal there is.
    { name: 'Meta Pixel', category: 'adPixel', re: /connect\.facebook\.net\/[^"']*fbevents|fbq\s*\(\s*['"]init/i },
    { name: 'TikTok Pixel', category: 'adPixel', re: /analytics\.tiktok\.com|ttq\.load\s*\(/i },
    { name: 'Google Ads', category: 'adPixel', re: /googleads\.g\.doubleclick\.net|gtag\/js\?id=AW-/i },
    { name: 'Pinterest Tag', category: 'adPixel', re: /s\.pinimg\.com\/ct\/core\.js|pintrk\s*\(/i },
    { name: 'Snap Pixel', category: 'adPixel', re: /sc-static\.net\/scevent|snaptr\s*\(/i },
    { name: 'Reddit Pixel', category: 'adPixel', re: /redditstatic\.com\/ads|rdt\s*\(/i },
    { name: 'LinkedIn Insight', category: 'adPixel', re: /snap\.licdn\.com\/li\.lms-analytics/i },
    { name: 'Taboola', category: 'adPixel', re: /cdn\.taboola\.com/i },
    { name: 'Outbrain', category: 'adPixel', re: /outbrain\.com\/outbrain\.js|obApi\s*\(/i },

    { name: 'Google Analytics 4', category: 'analytics', re: /gtag\/js\?id=G-|googletagmanager\.com\/gtag/i },
    { name: 'Google Tag Manager', category: 'analytics', re: /googletagmanager\.com\/gtm\.js/i },
    { name: 'Triple Whale', category: 'analytics', re: /triplewhale|triplepixel/i },
    { name: 'Northbeam', category: 'analytics', re: /northbeam\.io/i },
    { name: 'Elevar', category: 'analytics', re: /getelevar\.com/i },
    { name: 'Hotjar', category: 'analytics', re: /static\.hotjar\.com/i },
    { name: 'Microsoft Clarity', category: 'analytics', re: /clarity\.ms/i },
    { name: 'Segment', category: 'analytics', re: /cdn\.segment\.(com|io)/i },

    { name: 'Klaviyo', category: 'email', re: /klaviyo\.com|static\.klaviyo/i },
    { name: 'Mailchimp', category: 'email', re: /chimpstatic\.com|list-manage\.com/i },
    { name: 'Omnisend', category: 'email', re: /omnisend/i },
    { name: 'Drip', category: 'email', re: /getdrip\.com/i },
    { name: 'Sendlane', category: 'email', re: /sendlane/i },

    { name: 'Attentive', category: 'sms', re: /attentivemobile\.com|attn\.tv/i },
    { name: 'Postscript', category: 'sms', re: /postscript\.io/i },
    { name: 'Emotive', category: 'sms', re: /emotive\.io/i },

    { name: 'Recharge', category: 'subscription', re: /rechargepayments\.com|rechargeapps\.com/i },
    { name: 'Skio', category: 'subscription', re: /skio\.com/i },
    { name: 'Loop Subscriptions', category: 'subscription', re: /loopwork\.co|loopsubscriptions/i },
    { name: 'Stay AI', category: 'subscription', re: /stay-ai\.com|retextion/i },

    { name: 'Okendo', category: 'reviews', re: /okendo\.io/i },
    { name: 'Yotpo', category: 'reviews', re: /yotpo\.com/i },
    { name: 'Judge.me', category: 'reviews', re: /judge\.me/i },
    { name: 'Loox', category: 'reviews', re: /loox\.io/i },
    { name: 'Stamped', category: 'reviews', re: /stamped\.io/i },
    { name: 'Trustpilot widget', category: 'reviews', re: /widget\.trustpilot\.com/i },
    { name: 'Fera', category: 'reviews', re: /fera\.ai/i },

    { name: 'Rebuy', category: 'cro', re: /rebuyengine\.com/i },
    { name: 'Nosto', category: 'personalisation', re: /nosto\.com/i },
    { name: 'Dynamic Yield', category: 'personalisation', re: /dynamicyield\.com/i },
    { name: 'Justuno', category: 'cro', re: /justuno\.com/i },
    { name: 'OptinMonster', category: 'cro', re: /optinmonster|omappapi/i },
    { name: 'Privy', category: 'cro', re: /privy\.com|privymktg/i },
    { name: 'Octane AI', category: 'cro', re: /octaneai\.com/i },
    { name: 'VWO', category: 'cro', re: /visualwebsiteoptimizer|vwo\.com/i },
    { name: 'Optimizely', category: 'cro', re: /optimizely\.com/i },

    { name: 'Gorgias', category: 'support', re: /gorgias\.(chat|com)/i },
    { name: 'Intercom', category: 'support', re: /intercomcdn\.com|widget\.intercom\.io/i },
    { name: 'Zendesk', category: 'support', re: /zdassets\.com|zendesk\.com/i },
    { name: 'Tidio', category: 'support', re: /tidio(chat)?\./i },

    { name: 'Shop Pay', category: 'payments', re: /shop_pay|shopifycloud\/shop-js/i },
    { name: 'Klarna', category: 'payments', re: /klarna\.com|klarnaservices/i },
    { name: 'Afterpay', category: 'payments', re: /afterpay\.com/i },
    { name: 'Affirm', category: 'payments', re: /affirm\.com/i },
    { name: 'Sezzle', category: 'payments', re: /sezzle\.com/i },

    { name: 'Refersion', category: 'affiliate', re: /refersion\.com/i },
    { name: 'Impact', category: 'affiliate', re: /impactradius|impact\.com/i },
    { name: 'ShareASale', category: 'affiliate', re: /shareasale\.com/i },
    { name: 'UpPromote', category: 'affiliate', re: /uppromote/i },
];

export interface TechStack {
    /** Detected tool names, grouped. */
    byCategory: Partial<Record<StackCategory, string[]>>;
    /** Flat list, for easy filtering across brands. */
    all: string[];
    /** At least one ad pixel — the brand is set up to buy traffic. */
    paidMediaTracking: boolean;
    /** Ad platforms it is measurably set up for. */
    paidChannels: string[];
    /** Runs lifecycle email and/or SMS. */
    lifecycleMarketing: boolean;
    /** Sells on subscription. */
    subscriptionCommerce: boolean;
    /** Collects reviews with a dedicated tool. */
    reviewProgramme: boolean;
    /** Buy-now-pay-later present — a price-resistance tell. */
    bnpl: boolean;
    /**
     * 0-100 rough sophistication proxy: how much of the standard DTC growth
     * stack is actually installed. Comparable across brands, not absolute.
     */
    sophisticationScore: number;
}

const SCORE_WEIGHTS: Partial<Record<StackCategory, number>> = {
    adPixel: 22, analytics: 12, email: 16, sms: 10, subscription: 12,
    reviews: 12, cro: 8, personalisation: 4, affiliate: 4,
};

export function detectTechStack(html: string): TechStack {
    const byCategory: Partial<Record<StackCategory, string[]>> = {};
    const all: string[] = [];

    for (const { name, category, re } of FINGERPRINTS) {
        if (!re.test(html)) continue;
        (byCategory[category] ??= []).push(name);
        all.push(name);
    }

    const adPixels = byCategory.adPixel ?? [];
    let score = 0;
    for (const [category, weight] of Object.entries(SCORE_WEIGHTS)) {
        if ((byCategory[category as StackCategory] ?? []).length > 0) score += weight;
    }

    return {
        byCategory,
        all,
        paidMediaTracking: adPixels.length > 0,
        paidChannels: adPixels,
        lifecycleMarketing: (byCategory.email ?? []).length > 0 || (byCategory.sms ?? []).length > 0,
        subscriptionCommerce: (byCategory.subscription ?? []).length > 0,
        reviewProgramme: (byCategory.reviews ?? []).length > 0,
        bnpl: (byCategory.payments ?? []).some((p) => ['Klarna', 'Afterpay', 'Affirm', 'Sezzle'].includes(p)),
        sophisticationScore: Math.min(100, score),
    };
}
