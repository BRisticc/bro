/**
 * The niche taxonomy.
 *
 * Shape: niche -> sub-niche -> weighted terms.
 * A term is either "phrase" (weight 1) or ["phrase", weight].
 * Weights encode specificity: "testosterone booster" is worth far more than
 * "energy", which almost every brand on earth says at least once.
 */

export type WeightedTerm = string | [string, number];

export interface SubNicheDef {
    terms: WeightedTerm[];
    /** Audience hints that only apply inside this sub-niche. */
    audience?: string[];
}

export type Taxonomy = Record<string, Record<string, SubNicheDef>>;

export const BUILT_IN_TAXONOMY: Taxonomy = {
    Supplements: {
        "Men's health": {
            terms: [['testosterone', 3], ['testosterone booster', 4], ['t-booster', 4], ['male vitality', 4],
                ['prostate', 3], ['sperm', 3], ['male fertility', 4], ['low t', 4], ['men\'s multivitamin', 4],
                ['libido', 2], ['erectile', 3], ['ed treatment', 3], ['virility', 3], ['tongkat ali', 4],
                ['fadogia', 4], ['ashwagandha', 1.5], ['dht', 2], ['hair loss supplement', 3]],
            audience: ['men'],
        },
        "Women's health": {
            terms: [['menopause', 4], ['perimenopause', 4], ['hot flashes', 3], ['pcos', 4], ['prenatal', 4],
                ['fertility supplement', 4], ['period', 2], ['menstrual', 3], ['hormone balance', 3],
                ['women\'s multivitamin', 4], ['vaginal health', 4], ['probiotic for women', 4], ['pms', 3],
                ['postpartum', 3], ['breastfeeding', 3], ['iron supplement', 2]],
            audience: ['women'],
        },
        'Sports & performance': {
            terms: [['pre-workout', 4], ['preworkout', 4], ['creatine', 4], ['whey protein', 4], ['bcaa', 4],
                ['eaa', 3], ['muscle gain', 3], ['post-workout', 3], ['electrolyte', 2.5], ['endurance', 2],
                ['protein powder', 3], ['mass gainer', 4], ['beta-alanine', 4], ['citrulline', 4], ['pump', 1.5]],
            audience: ['athletes'],
        },
        'Gut & digestive': {
            terms: [['probiotic', 3], ['prebiotic', 3], ['postbiotic', 4], ['gut health', 4], ['microbiome', 4],
                ['bloating', 3], ['digestive enzyme', 4], ['ibs', 3], ['leaky gut', 4], ['fiber supplement', 3],
                ['cfu', 3], ['regularity', 2], ['constipation', 2]],
        },
        'Sleep & stress': {
            terms: [['melatonin', 4], ['sleep aid', 4], ['insomnia', 3], ['deep sleep', 3], ['magnesium glycinate', 4],
                ['cortisol', 3], ['adaptogen', 3], ['stress relief', 3], ['calm', 1], ['l-theanine', 4],
                ['gaba', 3], ['sleep supplement', 4], ['wind down', 2]],
        },
        'Nootropics & focus': {
            terms: [['nootropic', 4], ['brain fog', 4], ['cognitive', 2.5], ['focus supplement', 4], ['memory support', 3],
                ['lion\'s mane', 4], ['alpha gpc', 4], ['mental clarity', 3], ['smart drug', 4], ['racetam', 4]],
        },
        'Weight management': {
            terms: [['weight loss', 3], ['fat burner', 4], ['appetite suppressant', 4], ['metabolism booster', 3],
                ['glp-1', 4], ['semaglutide', 4], ['thermogenic', 4], ['meal replacement', 3], ['calorie deficit', 3],
                ['slimming', 3], ['belly fat', 3]],
        },
        'Greens & wholefood': {
            terms: [['greens powder', 4], ['superfood', 3], ['spirulina', 3], ['chlorella', 3], ['moringa', 3],
                ['wheatgrass', 3], ['ag1', 3], ['daily greens', 4], ['whole food vitamin', 3]],
        },
        'Vitamins & minerals': {
            terms: [['multivitamin', 3], ['vitamin d', 2.5], ['vitamin c', 2], ['omega-3', 3], ['fish oil', 3],
                ['zinc', 2], ['magnesium', 2], ['collagen peptides', 3], ['b12', 2.5], ['iron', 1.5],
                ['gummy vitamin', 3], ['supplement', 1], ['capsules', 1], ['dietary supplement', 2]],
        },
        'Longevity & healthspan': {
            terms: [['nad+', 4], ['nmn', 4], ['resveratrol', 4], ['longevity', 3], ['anti-aging supplement', 4],
                ['cellular health', 3], ['healthspan', 4], ['mitochondria', 3], ['autophagy', 4], ['spermidine', 4]],
        },
        'Immunity': {
            terms: [['immune support', 4], ['immunity', 3], ['elderberry', 4], ['echinacea', 4], ['zinc lozenge', 4],
                ['cold and flu', 3], ['immune system', 2.5]],
        },
    },
    Skincare: {
        'Anti-aging': {
            terms: [['retinol', 4], ['retinoid', 4], ['fine lines', 4], ['wrinkle', 3.5], ['anti-aging', 3],
                ['collagen production', 3], ['firming', 3], ['peptide serum', 4], ['crow\'s feet', 4],
                ['bakuchiol', 4], ['tretinoin', 4], ['sagging skin', 3]],
        },
        'Acne & blemish': {
            terms: [['acne', 4], ['breakout', 3.5], ['blemish', 3.5], ['salicylic acid', 4], ['benzoyl peroxide', 4],
                ['blackhead', 4], ['pimple patch', 4], ['clogged pores', 3], ['cystic', 4], ['sebum', 3]],
        },
        'Hydration & barrier': {
            terms: [['hyaluronic acid', 4], ['moisturizer', 2.5], ['moisturiser', 2.5], ['skin barrier', 4],
                ['ceramide', 4], ['dry skin', 2.5], ['hydrating serum', 3], ['squalane', 4], ['dewy', 2]],
        },
        'Brightening & pigmentation': {
            terms: [['hyperpigmentation', 4], ['dark spots', 4], ['brightening', 3], ['vitamin c serum', 4],
                ['niacinamide', 3.5], ['melasma', 4], ['even skin tone', 3], ['glow serum', 2.5], ['tranexamic', 4]],
        },
        'Sun care': {
            terms: [['spf', 4], ['sunscreen', 4], ['uva', 3], ['uvb', 3], ['mineral sunscreen', 4],
                ['zinc oxide', 3], ['sun damage', 3], ['after sun', 3]],
        },
        'Body care': {
            terms: [['body lotion', 3.5], ['body wash', 3], ['keratosis', 4], ['stretch marks', 4],
                ['cellulite', 4], ['body scrub', 3], ['deodorant', 3], ['hand cream', 3]],
        },
        "Men's skincare": {
            terms: [['men\'s skincare', 4], ['aftershave', 3.5], ['razor burn', 4], ['beard care', 3],
                ['men\'s face wash', 4], ['skincare for men', 4]],
            audience: ['men'],
        },
        'Clean & natural': {
            terms: [['clean beauty', 4], ['non-toxic skincare', 4], ['fragrance-free', 2.5], ['reef safe', 3],
                ['cruelty-free', 2], ['vegan skincare', 3], ['ewg verified', 4]],
        },
    },
    Haircare: {
        'Hair growth & loss': {
            terms: [['hair loss', 4], ['hair growth', 4], ['thinning hair', 4], ['minoxidil', 4], ['finasteride', 4],
                ['balding', 4], ['receding hairline', 4], ['hair regrowth', 4], ['alopecia', 4], ['scalp serum', 3.5]],
        },
        'Scalp health': {
            terms: [['dandruff', 4], ['flaky scalp', 4], ['scalp care', 3.5], ['itchy scalp', 4], ['scalp scrub', 4],
                ['seborrheic', 4]],
        },
        'Styling & treatment': {
            terms: [['shampoo', 2.5], ['conditioner', 2.5], ['hair mask', 3], ['leave-in', 3], ['heat protectant', 3.5],
                ['curl cream', 3.5], ['frizz', 3], ['bond repair', 4], ['keratin treatment', 4], ['hair oil', 2.5]],
        },
        'Color': {
            terms: [['hair color', 3.5], ['hair dye', 3.5], ['grey coverage', 4], ['gray coverage', 4],
                ['toner', 2.5], ['purple shampoo', 4], ['at-home color', 4]],
        },
    },
    'Beauty & cosmetics': {
        'Makeup': {
            terms: [['foundation', 2.5], ['mascara', 4], ['lipstick', 4], ['concealer', 4], ['eyeshadow', 4],
                ['blush', 3.5], ['makeup', 3], ['brow gel', 4], ['setting spray', 4], ['lip gloss', 4]],
        },
        'Fragrance': {
            terms: [['perfume', 4], ['eau de parfum', 4], ['cologne', 4], ['fragrance notes', 4], ['top notes', 4],
                ['scent', 2], ['eau de toilette', 4]],
        },
        'Nails & lashes': {
            terms: [['nail polish', 4], ['gel nails', 4], ['press-on nails', 4], ['lash serum', 4],
                ['lash extensions', 4], ['manicure', 3.5]],
        },
        'Tools & devices': {
            terms: [['led mask', 4], ['microcurrent', 4], ['gua sha', 4], ['derma roller', 4], ['microneedling', 4],
                ['red light therapy', 4], ['facial device', 3.5], ['ipl', 3.5]],
        },
    },
    'Sexual wellness': {
        'Male sexual health': {
            terms: [['erectile dysfunction', 4], ['ed pills', 4], ['sildenafil', 4], ['tadalafil', 4],
                ['viagra', 4], ['cialis', 4], ['last longer', 3.5], ['premature ejaculation', 4], ['stamina', 2]],
            audience: ['men'],
        },
        'Female sexual health': {
            terms: [['female arousal', 4], ['vibrator', 4], ['lubricant', 3.5], ['libido for women', 4],
                ['pelvic floor', 4], ['intimacy', 2]],
            audience: ['women'],
        },
        'Contraception & fertility': {
            terms: [['birth control', 4], ['condom', 4], ['ovulation test', 4], ['fertility tracking', 4],
                ['plan b', 4], ['iud', 4]],
        },
    },
    'Health & telehealth': {
        'Telehealth & Rx': {
            terms: [['telehealth', 4], ['online doctor', 4], ['prescription', 3], ['licensed provider', 3.5],
                ['virtual consultation', 4], ['clinician', 2.5], ['fda-approved', 2.5], ['pharmacy', 2.5]],
        },
        'Diagnostics & testing': {
            terms: [['at-home test', 4], ['blood test', 4], ['biomarker', 4], ['lab results', 3.5],
                ['dna test', 4], ['microbiome test', 4], ['hormone test', 4], ['continuous glucose', 4]],
        },
        'Wearables & tracking': {
            terms: [['sleep tracker', 4], ['hrv', 4], ['wearable', 3.5], ['smart ring', 4], ['readiness score', 4],
                ['heart rate variability', 4]],
        },
    },
    'Food & beverage': {
        'Functional drinks': {
            terms: [['energy drink', 4], ['adaptogenic drink', 4], ['functional beverage', 4], ['sparkling water', 3.5],
                ['electrolyte drink', 3.5], ['kombucha', 4], ['mushroom coffee', 4], ['prebiotic soda', 4]],
        },
        'Coffee & tea': {
            terms: [['coffee beans', 4], ['single origin', 4], ['espresso', 3.5], ['cold brew', 4], ['matcha', 4],
                ['loose leaf tea', 4], ['roast', 2], ['herbal tea', 3.5]],
        },
        'Snacks & bars': {
            terms: [['protein bar', 4], ['snack bar', 3.5], ['jerky', 4], ['granola', 3.5], ['keto snack', 4],
                ['high protein snack', 4], ['gluten-free snack', 3]],
        },
        'Meal & nutrition': {
            terms: [['meal kit', 4], ['ready meals', 3.5], ['macros', 3], ['keto diet', 3], ['plant-based meal', 3.5],
                ['calories per serving', 2.5]],
        },
    },
    'Fitness & apparel': {
        'Activewear': {
            terms: [['leggings', 4], ['activewear', 4], ['gym wear', 4], ['sports bra', 4], ['athleisure', 4],
                ['squat proof', 4], ['moisture wicking', 3], ['compression', 2.5]],
        },
        'Equipment': {
            terms: [['dumbbell', 4], ['resistance band', 4], ['home gym', 4], ['kettlebell', 4], ['treadmill', 4],
                ['yoga mat', 4], ['massage gun', 4], ['foam roller', 4]],
        },
        'Programs & coaching': {
            terms: [['workout program', 4], ['training plan', 3.5], ['personal trainer', 3.5], ['fitness app', 4],
                ['coaching', 2], ['transformation program', 4]],
        },
        'Recovery': {
            terms: [['cold plunge', 4], ['sauna', 4], ['cryotherapy', 4], ['compression boots', 4],
                ['recovery', 1.5], ['mobility', 2.5]],
        },
    },
    'Apparel & accessories': {
        'Everyday apparel': {
            terms: [['t-shirt', 3], ['denim', 4], ['hoodie', 3], ['outerwear', 3.5], ['knitwear', 4],
                ['wardrobe', 2.5], ['fit guide', 2.5], ['sizing', 1.5]],
        },
        'Footwear': {
            terms: [['sneakers', 4], ['running shoes', 4], ['boots', 3], ['insole', 4], ['arch support', 4],
                ['barefoot shoes', 4], ['loafers', 4]],
        },
        'Jewellery & watches': {
            terms: [['jewelry', 4], ['jewellery', 4], ['engagement ring', 4], ['lab grown diamond', 4],
                ['watch movement', 4], ['sterling silver', 4], ['18k gold', 4]],
        },
        'Eyewear': {
            terms: [['eyeglasses', 4], ['sunglasses', 4], ['blue light glasses', 4], ['prescription lenses', 4],
                ['frames', 2], ['polarized', 3.5]],
        },
        'Underwear & intimates': {
            terms: [['underwear', 3.5], ['boxer briefs', 4], ['shapewear', 4], ['bra', 3], ['period underwear', 4],
                ['seamless', 2.5]],
        },
    },
    'Home & lifestyle': {
        'Sleep & bedding': {
            terms: [['mattress', 4], ['bed sheets', 4], ['weighted blanket', 4], ['pillow', 3], ['duvet', 4],
                ['cooling sheets', 4], ['memory foam', 4]],
        },
        'Cleaning & household': {
            terms: [['laundry detergent', 4], ['cleaning spray', 3.5], ['eco-friendly cleaning', 4],
                ['dish soap', 4], ['refill pods', 4], ['non-toxic home', 3.5]],
        },
        'Kitchen & cookware': {
            terms: [['cookware', 4], ['non-stick pan', 4], ['cast iron', 4], ['chef knife', 4], ['air fryer', 4],
                ['blender', 3.5]],
        },
        'Air & water': {
            terms: [['air purifier', 4], ['water filter', 4], ['reverse osmosis', 4], ['humidifier', 4],
                ['hepa', 4], ['pfas', 4]],
        },
    },
    'Baby & family': {
        'Baby care': {
            terms: [['diaper', 4], ['nappy', 4], ['baby formula', 4], ['swaddle', 4], ['newborn', 3.5],
                ['baby wipes', 4], ['stroller', 4], ['teething', 4]],
            audience: ['parents'],
        },
        'Kids': {
            terms: [['toddler', 3.5], ['kids vitamins', 4], ['children\'s', 2.5], ['toy', 2.5], ['screen time', 3],
                ['kids clothing', 3.5]],
            audience: ['parents'],
        },
    },
    'Pet care': {
        'Pet supplements': {
            terms: [['dog supplement', 4], ['pet joint', 4], ['cat health', 3.5], ['hip and joint', 4],
                ['pet probiotic', 4], ['calming chews', 4]],
            audience: ['pet owners'],
        },
        'Pet food': {
            terms: [['dog food', 4], ['cat food', 4], ['fresh pet food', 4], ['grain-free', 3.5], ['kibble', 4],
                ['raw diet', 3.5]],
            audience: ['pet owners'],
        },
        'Pet accessories': {
            terms: [['dog collar', 4], ['dog harness', 4], ['pet bed', 4], ['litter box', 4], ['dog toy', 3.5],
                ['grooming brush', 3.5]],
            audience: ['pet owners'],
        },
    },
    'Mental health & mindfulness': {
        'Therapy & counselling': {
            terms: [['therapy', 3], ['therapist', 4], ['counseling', 4], ['counselling', 4], ['mental health support', 3.5],
                ['cbt', 4], ['anxiety treatment', 4], ['depression', 3]],
        },
        'Meditation & habit': {
            terms: [['meditation', 4], ['mindfulness', 4], ['breathwork', 4], ['journaling', 4], ['habit tracker', 4],
                ['guided session', 3.5]],
        },
    },
    'CBD & alternatives': {
        'CBD & hemp': {
            terms: [['cbd', 4], ['hemp extract', 4], ['full spectrum', 4], ['cannabinoid', 4], ['cbg', 4], ['cbn', 4]],
        },
        'Functional mushrooms': {
            terms: [['reishi', 4], ['cordyceps', 4], ['chaga', 4], ['functional mushroom', 4], ['mushroom extract', 4]],
        },
        'Nicotine & cessation': {
            terms: [['nicotine pouch', 4], ['quit smoking', 4], ['vape', 4], ['nicotine-free', 4], ['zyn', 4]],
        },
    },
    'Tech & gadgets': {
        'Consumer electronics': {
            terms: [['headphones', 4], ['earbuds', 4], ['bluetooth speaker', 4], ['charger', 3], ['power bank', 4],
                ['battery life', 2.5]],
        },
        'Smart home': {
            terms: [['smart lock', 4], ['security camera', 4], ['smart lighting', 4], ['doorbell camera', 4],
                ['smart thermostat', 4]],
        },
        'Software & SaaS': {
            terms: [['free trial', 1.5], ['dashboard', 2.5], ['integrations', 3], ['api', 2.5], ['per month per user', 4],
                ['saas', 4], ['workflow automation', 4]],
            audience: ['businesses'],
        },
    },
    'Finance & services': {
        'Fintech': {
            terms: [['credit score', 4], ['savings account', 4], ['apy', 4], ['investing app', 4], ['cashback', 3.5],
                ['debit card', 3.5], ['crypto', 3.5]],
        },
        'Insurance': {
            terms: [['insurance', 4], ['premium quote', 4], ['coverage', 2.5], ['deductible', 4], ['policyholder', 4]],
        },
    },
    'Professional & B2B services': {
        'Recruitment & staffing': {
            terms: [['recruitment', 4], ['staffing', 4], ['headhunt', 4], ['headhunting', 4],
                ['talent acquisition', 4], ['executive search', 4], ['job placement', 4], ['permanent placement', 4],
                ['contract staffing', 4], ['candidate', 3], ['candidates', 3], ['shortlist', 3.5],
                ['applicant tracking', 4], ['vacancy', 3.5], ['vacancies', 3.5], ['job board', 3.5],
                ['hiring process', 3], ['we recruit', 4], ['recruiter', 4], ['talent pool', 4],
                ['outstaffing', 4], ['rpo', 4], ['cv screening', 4], ['time to hire', 4]],
            audience: ['businesses', 'hiring managers'],
        },
        'Marketing & creative agency': {
            terms: [['media buying', 4], ['performance marketing', 4], ['paid social', 4], ['ppc', 4],
                ['seo agency', 4], ['creative agency', 4], ['brand agency', 4], ['marketing agency', 4],
                ['roas', 4], ['ad spend', 3.5], ['retainer', 3], ['campaign management', 3],
                ['growth marketing', 3.5], ['funnel', 2.5], ['our clients', 2]],
            audience: ['businesses'],
        },
        'Consulting & advisory': {
            terms: [['consulting', 3.5], ['consultancy', 4], ['advisory', 3.5], ['management consulting', 4],
                ['strategy consulting', 4], ['due diligence', 4], ['business transformation', 4],
                ['operating model', 4], ['engagement model', 3.5], ['case study', 1.5]],
            audience: ['businesses'],
        },
        'Software & IT services': {
            terms: [['software development', 4], ['custom software', 4], ['dedicated team', 4],
                ['nearshore', 4], ['offshore development', 4], ['outsourcing', 3.5], ['staff augmentation', 4],
                ['it services', 4], ['devops', 3.5], ['system integration', 4], ['managed services', 4]],
            audience: ['businesses'],
        },
        'Training & education': {
            terms: [['bootcamp', 4], ['certification', 3], ['curriculum', 3.5], ['cohort', 4],
                ['enrol', 3], ['enroll', 3], ['upskilling', 4], ['reskilling', 4], ['syllabus', 4],
                ['online course', 3.5], ['masterclass', 3.5]],
        },
        'Legal, finance & compliance services': {
            terms: [['law firm', 4], ['solicitor', 4], ['attorney', 4], ['legal advice', 4],
                ['bookkeeping', 4], ['accountancy', 4], ['accounting firm', 4], ['payroll', 4],
                ['tax advisory', 4], ['compliance audit', 4], ['gdpr', 3]],
            audience: ['businesses'],
        },
    },
    'Outdoor & travel': {
        'Outdoor gear': {
            terms: [['camping', 4], ['hiking', 4], ['backpack', 3], ['tent', 4], ['waterproof jacket', 4],
                ['trail', 2.5]],
        },
        'Travel': {
            terms: [['luggage', 4], ['carry-on', 4], ['packing cube', 4], ['travel pillow', 4], ['tsa', 4]],
        },
    },
};

/** Audience signals scored independently of the niche. */
export const AUDIENCE_TERMS: Record<string, WeightedTerm[]> = {
    men: [['for men', 4], ['men\'s', 3.5], ['guys', 2.5], ['male', 2.5], ['dad', 2], ['him', 1],
        ['gentlemen', 3], ['bro', 1.5], ['beard', 2.5], ['testosterone', 2]],
    women: [['for women', 4], ['women\'s', 3.5], ['ladies', 2.5], ['female', 2.5], ['mom', 2], ['her', 1],
        ['girl', 1.5], ['menopause', 3], ['pregnancy', 2.5]],
    'unisex / all genders': [['for everyone', 3], ['unisex', 4], ['gender neutral', 4], ['all genders', 4]],
    athletes: [['athlete', 4], ['lifter', 3.5], ['runner', 3], ['crossfit', 4], ['gym-goer', 4], ['bodybuilder', 4]],
    'seniors / 50+': [['over 50', 4], ['seniors', 4], ['aging adults', 3.5], ['65+', 4], ['retirees', 4]],
    'teens & young adults': [['teen', 4], ['gen z', 4], ['college student', 4], ['young adults', 3.5]],
    parents: [['parents', 3.5], ['new mom', 4], ['new parents', 4], ['toddler', 3], ['baby', 2]],
    'pet owners': [['pet parent', 4], ['dog owner', 4], ['cat owner', 4], ['fur baby', 4]],
    professionals: [['busy professional', 4], ['executive', 3], ['founder', 2.5], ['entrepreneur', 3]],
    businesses: [['b2b', 4], ['for teams', 3.5], ['enterprise', 3], ['your business', 3],
        ['your company', 3], ['our clients', 2.5], ['partner with us', 3]],
    'hiring managers': [['hiring manager', 4], ['talent acquisition', 3.5], ['your next hire', 4],
        ['scale your team', 4], ['grow your team', 3.5], ['hr team', 3.5]],
    'job seekers': [['your next role', 4], ['job seekers', 4], ['apply now', 2.5], ['open roles', 4],
        ['career opportunities', 3.5], ['send us your cv', 4], ['browse jobs', 4]],
    vegans: [['vegan', 3], ['plant-based', 3], ['dairy-free', 2.5]],
};

/** Merges a user-supplied taxonomy over the built-in one, sub-niche by sub-niche. */
export function mergeTaxonomy(base: Taxonomy, override?: Taxonomy | null): Taxonomy {
    if (!override) return base;
    const merged: Taxonomy = structuredClone(base);
    for (const [niche, subNiches] of Object.entries(override)) {
        if (!subNiches || typeof subNiches !== 'object') continue;
        merged[niche] = { ...(merged[niche] ?? {}) };
        for (const [subNiche, def] of Object.entries(subNiches)) {
            if (!def || !Array.isArray(def.terms)) continue;
            const target = merged[niche];
            if (target) target[subNiche] = { terms: def.terms, ...(def.audience ? { audience: def.audience } : {}) };
        }
    }
    return merged;
}

export function termWeight(term: WeightedTerm): { text: string; weight: number } {
    if (typeof term === 'string') return { text: term, weight: 1 };
    return { text: term[0], weight: term[1] };
}
