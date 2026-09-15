/**
 * The angle library.
 *
 * Each entry is one recognised direct-response angle with the surface patterns
 * that betray it in ad copy. Patterns are matched against normalised text;
 * `weight` reflects how diagnostic a pattern is (a "money-back guarantee" is a
 * near-certain risk-reversal play, whereas "results" could be anything).
 */

export interface AnglePattern {
    re: RegExp;
    weight: number;
}

export interface AngleDef {
    /** Stable machine key, used in dataset fields and aggregation. */
    key: string;
    /** Human label for reports. */
    label: string;
    /** What the angle is doing, for the report legend. */
    description: string;
    patterns: AnglePattern[];
}

const p = (source: string, weight = 1): AnglePattern => ({ re: new RegExp(source, 'gi'), weight });

export const ANGLE_LIBRARY: AngleDef[] = [
    {
        key: 'problem-agitation',
        label: 'Problem / agitation',
        description: 'Names the pain and turns up the heat before offering relief.',
        patterns: [
            p('\\b(tired of|sick of|fed up with|struggling with|suffering from)\\b', 3),
            p('\\b(embarrassed|frustrated|exhausted|miserable|hopeless)\\b', 2),
            p('\\b(stop (losing|wasting|suffering)|no longer have to)\\b', 2),
            p('\\b(hate|dread|can\'?t stand)\\b', 1.5),
            p("\\bif you'?re (still|constantly|always)\\b", 2),
            p('\\b(problem|issue|struggle)\\b', 0.6),
        ],
    },
    {
        key: 'mechanism',
        label: 'Unique mechanism',
        description: 'Explains the specific "how" that makes the product work — the classic differentiator.',
        patterns: [
            p('\\b(works by|mechanism|targets the (root|underlying)|patented|proprietary)\\b', 3),
            p('\\b(clinically (formulated|dosed)|bioavailab\\w+|absorption rate|time.?release)\\b', 3),
            p('\\b(the (real|actual|root) cause)\\b', 2.5),
            p('\\b(formula|formulated with|blend of)\\b', 1),
            p("\\bhere'?s how it works\\b", 3),
        ],
    },
    {
        key: 'authority-science',
        label: 'Authority / science',
        description: 'Borrows credibility from experts, studies, labs or certifications.',
        patterns: [
            p('\\b(clinically (proven|tested|studied)|peer.?reviewed|double.?blind|placebo)\\b', 3),
            p('\\b(doctor|physician|dermatologist|nutritionist|phd|md|scientist|researcher)s?\\b', 2.5),
            p('\\b(studies show|research shows|according to (a )?study|published in)\\b', 3),
            p('\\b(third.?party tested|gmp|nsf certified|fda.?(registered|approved)|lab.?tested)\\b', 2.5),
            p('\\b(harvard|stanford|mayo clinic|nih|journal of)\\b', 3),
        ],
    },
    {
        key: 'social-proof',
        label: 'Social proof',
        description: 'Leans on crowds, ratings and testimonials to de-risk the purchase.',
        patterns: [
            p('\\b(\\d[\\d,.]*\\+?\\s*(k|m|million|thousand)?\\s*(customers|reviews|people|users|members|sold))\\b', 3),
            p('\\b(join (over |more than )?\\d|trusted by|loved by)\\b', 3),
            p('\\b(5.?star|four point|4\\.\\d\\s*(/|out of)\\s*5|rated \\d)\\b', 2.5),
            p('\\b(best.?sell(er|ing)|viral|sold out|waitlist)\\b', 2),
            p('\\b(testimonial|real (customers|reviews)|verified (buyer|review))\\b', 2.5),
        ],
    },
    {
        key: 'transformation',
        label: 'Transformation / before-after',
        description: 'Sells the visible change and the timeline to get it.',
        patterns: [
            p('\\b(before and after|before / after|my results|the results)\\b', 3),
            p('\\b(in (as little as )?\\d+ (days|weeks|months))\\b', 2.5),
            p('\\b(went from .{0,30} to)\\b', 3),
            p('\\b(transform\\w*|life.?changing|night and day)\\b', 2),
            p('\\b(lost \\d+ ?(lbs|pounds|kg)|dropped \\d+)\\b', 3),
        ],
    },
    {
        key: 'founder-story',
        label: 'Founder / origin story',
        description: 'Uses a personal origin narrative to build trust and differentiation.',
        patterns: [
            p('\\b(our founder|i (started|created|built|founded)|we started)\\b', 3),
            p('\\b(after (years|months|decades) of)\\b', 2.5),
            p('\\b(so i (made|built|created)|that\'?s why (i|we) (made|built|created))\\b', 3),
            p('\\b(family.?(owned|run)|our story)\\b', 2),
        ],
    },
    {
        key: 'us-vs-them',
        label: 'Us vs. them',
        description: 'Positions against an enemy — competitors, the old way, or an industry.',
        patterns: [
            p('\\b(unlike (other|most|the)|most (brands|companies|products))\\b', 3),
            p("\\b(big (pharma|supplement|beauty|food)|the industry (doesn'?t|won'?t))\\b", 3),
            p("\\b(what (they|companies) don'?t want you to know)\\b", 3),
            p('\\b(no more (overpriced|watered.?down)|stop (paying|overpaying))\\b', 2.5),
            p('\\b(compared to|versus|vs\\.?)\\b', 1),
        ],
    },
    {
        key: 'curiosity',
        label: 'Curiosity / open loop',
        description: 'Withholds the payoff to buy the click.',
        patterns: [
            p('\\b(the (real|surprising|weird|one) (reason|thing|trick))\\b', 3),
            p('\\b(nobody (tells|talks about)|no one (tells|warns))\\b', 3),
            p('\\b(here\'?s why|this is why|turns out)\\b', 2),
            p('\\b(secret|little.?known|hidden|shocking)\\b', 2),
            p("\\b(you'?(ll|re) never guess|what happened next)\\b", 3),
        ],
    },
    {
        key: 'urgency-scarcity',
        label: 'Urgency / scarcity',
        description: 'Compresses the decision window with deadlines or stock limits.',
        patterns: [
            p('\\b(ends (today|tonight|soon)|last chance|final (hours|day))\\b', 3),
            p('\\b(selling out|almost gone|limited (stock|quantity|time|edition)|while supplies last)\\b', 3),
            p('\\b(only \\d+ left|back in stock|restock)\\b', 3),
            p('\\b(hurry|don\'?t miss|act now|today only)\\b', 2.5),
        ],
    },
    {
        key: 'offer-value',
        label: 'Offer / price-value',
        description: 'Leads with the deal rather than the product.',
        patterns: [
            p('\\b(\\d{1,2}% off|save \\$?\\d+|\\$\\d+ off)\\b', 3),
            p('\\b(buy one get one|bogo|free (shipping|gift|bottle|trial))\\b', 3),
            p('\\b(bundle|subscribe (and|&) save|starter kit)\\b', 2),
            p('\\b(cheaper than|less than (a|the) (cup of )?coffee|per day)\\b', 2.5),
            p('\\b(discount|deal|promo code|coupon)\\b', 1.5),
        ],
    },
    {
        key: 'risk-reversal',
        label: 'Risk reversal / guarantee',
        description: 'Removes the downside of trying.',
        patterns: [
            p('\\b(money.?back|refund|risk.?free|no questions asked)\\b', 3),
            p('\\b(\\d+.?(day|night) (guarantee|trial|promise))\\b', 3),
            p('\\b(cancel any ?time|free returns|satisfaction guaranteed)\\b', 2.5),
            p('\\b(if you don\'?t (love|see))\\b', 2.5),
        ],
    },
    {
        key: 'identity',
        label: 'Identity / tribal call-out',
        description: 'Speaks to a specific self-image so the right reader self-selects.',
        patterns: [
            p('\\b(for (men|women|moms|dads|guys|girls|athletes|lifters|runners|nurses|teachers) (who|over))\\b', 3),
            p('\\b(attention |calling all )\\b', 3),
            p('\\b(if you\'?re a \\w+)\\b', 2.5),
            p('\\b(men over \\d+|women over \\d+|\\d+\\+ (men|women))\\b', 3),
            p('\\b(built for|made for|designed for) (men|women|athletes|professionals)\\b', 2.5),
        ],
    },
    {
        key: 'fear-warning',
        label: 'Fear / warning',
        description: 'Frames inaction as the dangerous choice.',
        patterns: [
            p('\\b(warning|beware|danger\\w*|toxic|harmful)\\b', 3),
            p('\\b(stop (using|taking|doing)|throw away your)\\b', 2.5),
            p('\\b(could be (damaging|destroying|killing)|is ruining)\\b', 3),
            p('\\b(side effects|linked to (cancer|disease))\\b', 2.5),
            p('\\b(before it\'?s too late|don\'?t wait until)\\b', 3),
        ],
    },
    {
        key: 'convenience',
        label: 'Convenience / simplicity',
        description: 'Sells the absence of effort.',
        patterns: [
            p('\\b(in (just |under )?\\d+ (seconds|minutes)|takes \\d+ seconds)\\b', 3),
            p('\\b(one (scoop|pill|step|tap)|just add water|no (mixing|mess|prep))\\b', 3),
            p('\\b(effortless|hassle.?free|no more (guessing|counting))\\b', 2.5),
            p('\\b(delivered to your door|auto.?ship|on your schedule)\\b', 2),
        ],
    },
    {
        key: 'clean-natural',
        label: 'Clean / natural ingredients',
        description: 'Differentiates on what is NOT in the product.',
        patterns: [
            p('\\b(no (fillers|artificial|synthetic|sugar|gluten|parabens|sulfates|seed oils))\\b', 3),
            p('\\b(clean (ingredients|label|beauty)|non.?toxic|free from)\\b', 3),
            p('\\b(organic|all.?natural|plant.?based|vegan|cruelty.?free)\\b', 1.5),
            p('\\b(only \\d+ ingredients|\\d+ simple ingredients)\\b', 3),
        ],
    },
    {
        key: 'aspiration',
        label: 'Aspiration / status',
        description: 'Sells the identity upgrade rather than the function.',
        patterns: [
            p('\\b(look (younger|leaner|better)|feel (confident|unstoppable|amazing))\\b', 3),
            p('\\b(turn heads|people will ask|compliments)\\b', 3),
            p('\\b(best version of (yourself|you)|level up|upgrade your)\\b', 2.5),
            p('\\b(luxury|premium|elevated|indulg\\w+)\\b', 1.5),
        ],
    },
    {
        key: 'objection-handling',
        label: 'Objection handling',
        description: 'Pre-empts the reason the reader would say no.',
        patterns: [
            p("\\b(you (might|may) be thinking|i know what you'?re thinking)\\b", 3),
            p('\\b(but does it (actually |really )?work|is it worth it)\\b', 3),
            p("\\b(too good to be true|i was sceptical|i was skeptical|didn'?t believe)\\b", 3),
            p('\\b(no, (it|this) (isn\'?t|is not))\\b', 2),
        ],
    },
    {
        key: 'seasonal-event',
        label: 'Seasonal / event hook',
        description: 'Attaches the offer to a date on the reader\'s calendar.',
        patterns: [
            p('\\b(black friday|cyber monday|christmas|holiday|new year|valentine)\\b', 3),
            p('\\b(summer body|back to school|spring clean|resolution)\\b', 3),
            p("\\b(mother'?s day|father'?s day|prime day)\\b", 3),
        ],
    },
    {
        key: 'ingredient-hero',
        label: 'Hero ingredient',
        description: 'Leads with one named ingredient as the reason to believe.',
        patterns: [
            p('\\b(\\d+\\s?mg of)\\b', 3),
            p('\\b(clinical dose|full dose|standardi[sz]ed extract)\\b', 3),
            p('\\b(powered by|infused with|packed with) \\w+', 2),
            p('\\b(retinol|niacinamide|hyaluronic|creatine|ashwagandha|magnesium|collagen|peptide)s?\\b', 1.5),
        ],
    },
    {
        key: 'ugc-testimonial',
        label: 'Customer voice / UGC',
        description: 'Written as a customer speaking, not a brand broadcasting.',
        patterns: [
            p("\\b(i'?ve been using|i started (taking|using)|my (skin|hair|energy|sleep|doctor))\\b", 3),
            p('\\b(honestly|ngl|not gonna lie|obsessed|literally)\\b', 2),
            p('\\b(i was (sceptical|skeptical|shocked|amazed))\\b', 3),
            p('\\b(would recommend|10/10|game.?changer)\\b', 2.5),
        ],
    },
];

export const ANGLE_BY_KEY = new Map(ANGLE_LIBRARY.map((a) => [a.key, a]));

/** Emotional register detected alongside the angle. */
export const EMOTION_PATTERNS: Array<{ emotion: string; re: RegExp }> = [
    { emotion: 'frustration', re: /\b(frustrat\w+|annoying|tired of|sick of|fed up|struggle)\b/gi },
    { emotion: 'fear', re: /\b(afraid|scary|dangerous|risk|warning|damage|irreversible)\b/gi },
    { emotion: 'hope', re: /\b(finally|at last|hope|there is a way|it is possible)\b/gi },
    { emotion: 'embarrassment', re: /\b(embarrass\w+|ashamed|awkward|self.?conscious|hide)\b/gi },
    { emotion: 'pride', re: /\b(proud|confidence|confident|earn|deserve|achievement)\b/gi },
    { emotion: 'belonging', re: /\b(join|community|thousands of (people|men|women)|you'?re not alone)\b/gi },
    { emotion: 'relief', re: /\b(relief|relax|calm|finally sleep|no more pain|ease)\b/gi },
    { emotion: 'desire', re: /\b(crave|want|dream|glow|irresistible|delicious)\b/gi },
    { emotion: 'curiosity', re: /\b(secret|surprising|weird|why|what if|turns out)\b/gi },
    { emotion: 'anger', re: /\b(scam|rip.?off|lie|lied|fraud|outrage\w*)\b/gi },
    { emotion: 'trust', re: /\b(guarantee|certified|transparent|honest|no hidden)\b/gi },
    { emotion: 'urgency', re: /\b(now|today|hurry|don'?t wait|deadline|last chance)\b/gi },
];
