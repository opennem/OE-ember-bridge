# OE-ember-bridge
_A bridge between OpenElectricity and the Ember Climate electricity data API._

This simple JavaScript (nodejs/express) server accepts incoming requests for energy data (monthly or annual) for a country or country grouping, fetches the data from Ember, transforms and vends the data in the format used by OpenElectricity.

The server caches country data for 2 hours.