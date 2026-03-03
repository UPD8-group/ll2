exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let query;
  try {
    ({ query } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  if (!query) {
    return { statusCode: 400, body: "Missing query" };
  }

  const SYSTEM_PROMPT = `You are Bob, an ASX investment analyst. Find 3 real ASX companies matching the user's query using web search. Score each on 8 factors (1-10): business_quality, balance_sheet, valuation, management, moat, momentum, news_flow, deal_quality. Return ONLY valid JSON, no markdown, no preamble:
{"query":"","scan_date":"","companies":[{"name":"","asx_code":"ASX:XXX","sector":"","market_cap":"","composite_score":0,"category_scores":{"business_quality":0,"balance_sheet":0,"valuation":0,"management":0,"moat":0,"momentum":0,"news_flow":0,"deal_quality":0},"recommendation":"STRONG INTEREST|WORTH WATCHING|PASS","green_flags":[],"red_flags":[],"one_liner":""}],"top_pick":"ASX:XXX","top_pick_reason":""}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: query }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: data.error?.message || "Claude API error" })
      };
    }

    const textBlocks = data.content.filter(b => b.type === "text");
    const rawText = textBlocks.map(b => b.text).join("");
    const clean = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: clean, parse_error: true })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
