const ALLOWED_AMOUNTS = [200, 500, 1000];

// $2 = Standard Intelligence report
// $5 or $10 = Deep Dive report (verdict + score + pre-purchase checklist)
function getTier(amount) {
    return amount >= 500 ? 'deep-dive' : 'standard';
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    try {
        const body = JSON.parse(event.body || '{}');
        const requestedAmount = parseInt(body.amount, 10);
        const amount = ALLOWED_AMOUNTS.includes(requestedAmount) ? requestedAmount : 200;
        const amountLabel = { 200: '$2.00', 500: '$5.00', 1000: '$10.00' }[amount] || '$2.00';
        const tier = getTier(amount);

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'aud',
            automatic_payment_methods: { enabled: true },
            metadata: { product: 'listing_lens_report', chosen_amount: amountLabel, tier, report_generated: 'false' }
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id,
                amount,
                amountLabel,
                tier
            })
        };
    } catch (error) {
        console.error('Stripe error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Payment setup failed', message: error.message }) };
    }
};
