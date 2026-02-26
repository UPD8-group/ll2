/**
 * LISTING LENS — Create Payment
 * Single tier: $3 AUD per report
 */

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: 300,        // $3.00 AUD — fixed, single tier
            currency: 'aud',
            automatic_payment_methods: { enabled: true },
            metadata: {
                product: 'listing_lens_report',
                amount_label: '$3.00',
                report_generated: 'false'
            }
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id,
                amount: 300,
                amountLabel: '$3.00'
            })
        };

    } catch (error) {
        console.error('Stripe error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Payment setup failed', message: error.message })
        };
    }
};
