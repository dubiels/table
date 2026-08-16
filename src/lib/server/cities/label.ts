/**
 * How a city is written down once it has been matched.
 *
 * This is the value that lands in `people.city`, so it is the thing you read on
 * a person's record. Keeping it a derived string rather than the stored truth is
 * what lets the format change later without a data migration — `people.cityId`
 * carries the identity.
 */
export type CityRow = {
	name: string;
	countryCode: string;
	countryName: string;
	admin1Code: string | null;
	admin1Name: string | null;
};

/**
 * `San Francisco, CA` at home, `Berlin, Germany` abroad.
 *
 * US rows get the state because that is how the address is spoken and because
 * `admin1_code` is already the postal abbreviation there. Everywhere else the
 * code is an opaque number, so the country reads better than the region — and a
 * US row missing its state falls back to the same form rather than rendering a
 * dangling comma.
 */
export function cityLabel(city: CityRow): string {
	if (city.countryCode === 'US' && city.admin1Code) return `${city.name}, ${city.admin1Code}`;
	return `${city.name}, ${city.countryName}`;
}

/**
 * The dimmed second line in the dropdown — what separates two identically named
 * places once the label alone stops being enough.
 */
export function citySecondaryLabel(city: CityRow): string | null {
	if (city.countryCode === 'US') return city.admin1Name;
	return [city.admin1Name, city.countryName].filter(Boolean).join(', ') || null;
}
