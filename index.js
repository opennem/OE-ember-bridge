const express = require("express");
const NodeCache = require("node-cache");

const path = require("path");
const fs = require("fs");

// import my modules
const countries = require("./countries");
const fetchData = require("./ember");

const app = express();
const port = process.env.PORT || 3000;

// initialize NodeCache with a default TTL of 2 hours = 60 * 60 * 2 seconds
const cache = new NodeCache({ stdTTL: 60 * 60 * 2 });

// middleware to cache energy data responses
function cacheMiddleware(req, res, next) {
  const key = req.originalUrl || req.url;
  const cacheContent = cache.get(key);
  if (cacheContent) {
    console.log("cache hit for:", key);
    res.send(cacheContent);
  } else {
    console.log("cache miss for:", key);
    // overwrite the `res.send` method to cache the response data
    res.sendResponse = res.send;
    res.send = (body) => {
      cache.set(key, body);
      res.sendResponse(body);
    };
    next();
  }
}

// endpoint to fetch list of supported countries and regions
app.get("/api/countries", (req, res) => {
  res.json(countries);
});

// endpoint to fetch historical energy data
app.get("/v4/ember/:code/:period.json", cacheMiddleware, async (req, res) => {
  const { code, period } = req.params;

  // lookup the name from the country's/region's code
  const entity = countries.find((c) => c.iso === code);

  // if period is not 'monthly' or 'yearly' then fail with a 404
  if (period !== "monthly" && period !== "yearly") {
    console.log(`period '${period}' is not monthly or yearly`);
    res
      .status(404)
      .json({ error: `period '${period}' is not monthly or yearly` });
    return;
  }

  // if entity is not found then fail with a 404
  if (!entity) {
    console.log(`code '${code}' does not map to a known country or region`);
    res.status(404).json({
      error: `code '${code}' does not map to a known country or region`,
    });
    return;
  }

  try {
    console.log(`fetching ${period} data for country/region ${entity.name}`);

    const data = await fetchData(entity.name, code, period);

    const dataStr = JSON.stringify(data, undefined, 2);
    const formatted = formatNumericArrays(dataStr);

    // set the content type to application/json; charset=utf-8
    res.set("Content-Type", "application/json; charset=utf-8");
    res.send(formatted);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching energy data");
  }
});

// endpoint to fetch cache statistics
app.get("/api/cache-stats", (req, res) => {
  const stats = cache.getStats();
  res.json(stats);
});

// serve the HTML index page
app.use(express.static(path.join(__dirname, "public")));

app.listen(port, () => {
  console.log(`oe-ember-bridge running on http://localhost:${port}`);
});

function formatNumericArrays(inputString) {
  // Regular expression to match arrays containing numbers (integers or floats)
  const numberArrayRegex = /\[(\s*-?\d+(\.\d+)?\s*,\s*)*-?\d+(\.\d+)?\s*\]/g;

  return inputString.replace(numberArrayRegex, (match) => {
    // Remove all extra whitespace around commas within the matched number array
    return match.replace(/\s*,\s*/g, ", ");
  });
}

// async function harness(countryCode, period) {
//   // lookup the name from the country's/region's code
//   const entity = countries.find((c) => c.iso === countryCode);

//   // if entity is not found then fail with a 404
//   if (!entity) {
//     console.log(`code '${countryCode}' does not map to a known country or region`);
//     return;
//   }

//   try {
//     console.log(`fetching ${period} data for country/region ${entity.name}`);

//     const data = await fetchData(entity.name, countryCode, period);

//     const dataStr = JSON.stringify(data, undefined, 2);
//     const formatted = formatNumericArrays(dataStr);

//     console.log("\n\n\n");
//     console.log(formatted)
//   } catch (error) {
//     console.log("Error fetching energy data: ", error);
//   }
// }

// harness(`AUS`, `yearly`);
