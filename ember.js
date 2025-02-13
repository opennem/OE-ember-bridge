const axios = require("axios");
const fs = require("fs");
const path = require("path");

const EMBER_API_KEY = process.env.EMBER_API_KEY;

async function fetchData(entityName, entityCode, period) {
  // grab energy and emissions data
  console.time("fetchData");
  const energy = await fetchDataType(entityName, entityCode, "energy", period);
  const co2 = await fetchDataType(entityName, entityCode, "emissions", period);
  console.timeEnd("fetchData");

  const data = energy.concat(co2);

  // add the metadata to the output tree
  const output = {
    version: "4.1",
    name: entityName,
    network: entityCode,
    created_at: getCurrentDateTimeInPlus10(),
    messages: [
      "Data gratefully sourced from Ember Climate -- see api.ember-energy.org/docs",
    ],
    data: data,
  };

  // console.log(output);

  return output;
}

function constructURL(type, period) {
  switch (type) {
    case "energy":
      return (
        "https://api.ember-energy.org/v1/electricity-generation/" + period
      );

    case "emissions":
      return (
        "https://api.ember-energy.org/v1/power-sector-emissions/" + period
      );

    default:
      throw new Error("invalid type: " + type);
  }
}

async function fetchDataType(entityName, entityCode, type, period) {
  console.log(`fetch ${type}/${period} data for ${entityCode} (${entityName})`);

  const params = {
    entity: entityName,
    series:
      "Bioenergy,Coal,Gas,Hydro,Nuclear,Other fossil,Solar,Wind,Net imports,Demand",
    include_all_dates_value_range: "false",
    api_key: EMBER_API_KEY,
  };

  const URL = constructURL(type, period);
  console.log("fetching:", URL);
  const response = await axios.get(URL, { params });

  // write response.data out to a file in output/{entity}.json
  writeDataToFile("output", `raw-${type}-${period}`, entityCode, response.data);

  const data = response.data.data;
  const df = makeFrame(data, type);
  const renamed = renameSeries(df);
  checkContiguousDates(renamed, period);
  const collated = getCollated(renamed, type, period, entityCode);

  writeDataToFile("output", `processed-${period}`, entityCode, collated);

  return collated;
}

// write data to a file
function writeDataToFile(directory, subdir, code, data) {
  const dirPath = path.join(__dirname, directory, subdir);
  const filePath = path.join(dirPath, code + ".json");

  // ensure the directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // if data is not a string object, then stringify it
  if (typeof data !== "string") {
    data = JSON.stringify(data, null, 2);
  }

  // write data to the file
  fs.writeFileSync(filePath, data);
}

function makeFrame(data, type) {
  const df = {};

  // get all unique series
  const seriesList = [...new Set(data.map((item) => item.series))];

  // get all unique dates
  const dates = [...new Set(data.map((item) => item.date))];

  // initialize an empty object for each series
  seriesList.forEach((series) => {
    df[series] = {};
    dates.forEach((date) => {
      df[series][date] = null; // initially, set each value to null
    });
  });

  // populate the dataframe-like structure with the values
  data.forEach((item) => {
    var value;

    switch (type) {
      case "energy":
        value = item.generation_twh;
        break;

      case "emissions":
        value = item.emissions_mtco2;
        break;

      default:
        throw new Error("invalid type: " + type);
    }

    df[item.series][item.date] = value;
  });

  // console.log("df", df)

  return df;
}

// create a new dataframe with renamed keys
function renameSeries(df) {
  const seriesMapping = {
    Bioenergy: "bioenergy",
    Coal: "coal",
    Demand: "demand",
    Gas: "gas",
    Hydro: "hydro",
    Nuclear: "nuclear",
    "Other fossil": "oil",
    Solar: "solar",
    Wind: "wind",
    "Net imports": "import",
  };

  // iterate through the original dataframe and rename the series keys
  const renamed = {};

  Object.keys(df).forEach((key) => {
    const newKey = seriesMapping[key] || key; // Use the new name if it exists, otherwise keep the old key
    renamed[newKey] = df[key];
  });

  return renamed;
}

function checkContiguousDates(data, period) {
  // helper function to generate date strings for a range of months
  function generateDateRange(startDate, endDate, period) {
    const dates = [];
    let currentDate = new Date(startDate);
    const end = new Date(endDate);

    while (currentDate <= end) {
      switch (period) {
        case "yearly":
          dates.push(currentDate.toISOString().slice(0, 4)); // YYYY
          currentDate.setFullYear(currentDate.getFullYear() + 1); // move to the next year
          break;

        case "monthly":
          dates.push(currentDate.toISOString().slice(0, 10)); // YYYY-MM-DD format
          currentDate.setMonth(currentDate.getMonth() + 1); // move to the next month
          break;

        default:
          throw new Error("invalid period: " + period);
      }
    }

    return dates;
  }

  // extract dates from the first series as reference
  const referenceSeries = Object.keys(data)[0];
  const referenceDates = Object.keys(data[referenceSeries]).sort();

  // validate that all series have the same dates
  for (const series in data) {
    const seriesDates = Object.keys(data[series]).sort();

    // check if all series have the same set of dates
    if (JSON.stringify(referenceDates) !== JSON.stringify(seriesDates)) {
      throw new Error(
        `series "${series}" does not have the same dates as the first series.`,
      );
    }
  }

  // check for gaps in the date range
  const firstDate = referenceDates[0];
  const lastDate = referenceDates[referenceDates.length - 1];
  const expectedDates = generateDateRange(firstDate, lastDate, period);

  if (JSON.stringify(referenceDates) !== JSON.stringify(expectedDates)) {
    console.log(referenceDates);
    console.log(expectedDates);
    throw new Error("there are gaps in the date range (missing months).");
  }
}

// get the interval signifier for the given period
function getIntervalForPeriod(period) {
  switch (period) {
    case "monthly":
      return "1M";

    case "yearly":
      return "1Y";

    default:
      throw new Error(`invalid period: ${period}`);
  }
}

// get the unit sigifier for the given type
function getUnitForType(type) {
  switch (type) {
    case "energy":
      return "TWh";

    case "emissions":
      return "MtCO2e";

    default:
      throw new Error(`invalid type: ${type}`);
  }
}

// format date for period
function formatDateForPeriod(date, period) {
  const dateObj = new Date(date);

  switch (period) {
    case "monthly":
      return dateObj.toISOString().slice(0, 7); // YYYY-MM format

    case "yearly":
      return dateObj.toISOString().slice(0, 4); // YYYY format

    default:
      throw new Error(`invalid period: ${period}`);
  }
}

// build the data sections
function getCollated(data, type, period, entityCode) {
  // object to hold the result arrays
  const result = [];

  // iterate over each series in the data (bioenergy, coal, demand, etc.)
  for (const series in data) {
    if (data.hasOwnProperty(series)) {
      // first get the dates in ascending date order
      const dates = Object.keys(data[series]).sort(
        (a, b) => new Date(a) - new Date(b),
      );

      // get the date-value pairs and sort by date
      const valueArray = dates.map((date) => data[series][date]); // get the values for each sorted date

      // determine whether all values in the array that are non-null and non-zero
      const isEmpty = valueArray.every(
        (value) => value == null || value == 0.0,
      );

      if (isEmpty) {
        console.log(
          `.stripped series ${type}/${period}:${series} as all values are null/zero`,
        );
      } else {
        // get the first and last date
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];

        // create the entity
        const entry = {
          id: `${entityCode}.${series}.${type}`, // generate unique IDs based on energy type
          network: entityCode,
          fuel_tech: series,
          type: type,
          units: getUnitForType(type),
          history: {
            start: formatDateForPeriod(startDate, period),
            last: formatDateForPeriod(endDate, period),
            interval: getIntervalForPeriod(period),
            data: valueArray, // the data series
          },
        };

        result.push(entry);
      }
    }
  }

  return result;
}

function getCurrentDateTimeInPlus10() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + 600); // Adjust to +10:00

  return now.toISOString().slice(0, 19) + "+10:00";
}

module.exports = fetchData;
