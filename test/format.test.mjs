// Description: Offline tests for the Steam-to-Notion property formatting helpers (js/gameProperties.js)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	getGameNameProperty,
	getGameReviewScore,
	getGameReleaseDate,
	getGameStorePage,
	getGamePrice,
	getSteamDeckCompatibility,
	getGameDevelopers,
	getGamePublishers,
	getGameDescription,
	getGameCoverImage,
	getGameIcon
} from '../js/gameProperties.js';
import { pagesToUpdate } from '../js/utils.js';

describe('pagesToUpdate', () => {
	it('skips a page already stored with its current App ID', () => {
		const { appIds } = pagesToUpdate({
			steamAppIdByPage: { pageA: 400, pageB: 620 },
			editedByByPage: { pageA: 'u', pageB: 'u' },
			storedAppIdByPage: { pageA: 400, pageB: null },
			alwaysUpdate: false
		});
		assert.deepEqual(appIds, { pageB: 620 }, 'the already-processed pageA is removed, the new pageB kept');
	});

	it('does NOT skip a different page that merely shares an App ID with an already-stored page', () => {
		// The core regression: pageA(400) is stored; pageB also references 400 but is a new page and must still be processed
		const { appIds } = pagesToUpdate({
			steamAppIdByPage: { pageA: 400, pageB: 400 },
			editedByByPage: { pageA: 'u', pageB: 'u' },
			storedAppIdByPage: { pageA: 400, pageB: null },
			alwaysUpdate: false
		});
		assert.deepEqual(appIds, { pageB: 400 }, 'pageB (same App ID, different page) must not be dropped');
	});

	it('re-processes a page whose App ID changed', () => {
		const { appIds } = pagesToUpdate({
			steamAppIdByPage: { pageA: 999 },
			editedByByPage: { pageA: 'u' },
			storedAppIdByPage: { pageA: 400 },
			alwaysUpdate: false
		});
		assert.deepEqual(appIds, { pageA: 999 }, 'a changed App ID means the page is re-processed');
	});

	it('in alwaysUpdate mode only skips already-stored pages the integration itself last edited', () => {
		const { appIds } = pagesToUpdate({
			steamAppIdByPage: { own: 400, other: 620, newOwn: 700 },
			editedByByPage: { own: 'integration', other: 'someoneElse', newOwn: 'integration' },
			storedAppIdByPage: { own: 400, other: 620, newOwn: null },
			alwaysUpdate: true,
			integrationUserId: 'integration'
		});
		// "own" is skipped (integration-edited + stored); "other" kept (someone else edited); "newOwn" kept (not yet stored)
		assert.deepEqual(appIds, { other: 620, newOwn: 700 });
	});
});

describe('getGameNameProperty', () => {
	const prop = { enabled: true, notionProperty: 'Name', isPageTitle: true };

	it('writes a title property when isPageTitle is true', () => {
		const out = getGameNameProperty(prop, { name: 'Hades' }, {});
		assert.equal(out.Name.title[0].text.content, 'Hades');
	});

	it('writes a rich_text property when isPageTitle is false', () => {
		const out = getGameNameProperty({ ...prop, isPageTitle: false }, { name: 'Hades' }, {});
		assert.equal(out.Name.rich_text[0].text.content, 'Hades');
	});

	it('leaves the properties unchanged when disabled or the name is missing', () => {
		assert.deepEqual(getGameNameProperty({ ...prop, enabled: false }, { name: 'Hades' }, {}), {});
		assert.deepEqual(getGameNameProperty(prop, {}, {}), {});
	});
});

describe('getGameReviewScore', () => {
	const reviews = { total_reviews: 200, total_positive: 150, total_negative: 50, review_score_desc: 'Very Positive' };
	const prop = (format) => ({ enabled: true, format, notionProperty: 'Reviews' });

	it('formats a percentage rounded to two decimals', () => {
		assert.equal(getGameReviewScore(prop('percentage'), reviews, {}).Reviews.number, 0.75);
	});

	it('formats a sentiment as a select', () => {
		assert.equal(getGameReviewScore(prop('sentiment'), reviews, {}).Reviews.select.name, 'Very Positive');
	});

	it('formats total, positive and negative counts', () => {
		assert.equal(getGameReviewScore(prop('total'), reviews, {}).Reviews.number, 200);
		assert.equal(getGameReviewScore(prop('positive'), reviews, {}).Reviews.number, 150);
		assert.equal(getGameReviewScore(prop('negative'), reviews, {}).Reviews.number, 50);
	});

	it('formats positive/negative as rich text', () => {
		assert.equal(getGameReviewScore(prop('positive/negative'), reviews, {}).Reviews.rich_text[0].text.content, '150 positive / 50 negative');
	});

	it('leaves the properties unchanged with no review data, and avoids dividing by zero', () => {
		assert.deepEqual(getGameReviewScore(prop('percentage'), null, {}), {});
		assert.deepEqual(getGameReviewScore(prop('percentage'), { total_reviews: 0, total_positive: 0 }, {}), {});
	});
});

describe('getGameReleaseDate', () => {
	const prop = { enabled: true, notionProperty: 'Release Date' };
	const dateFor = (date) => getGameReleaseDate(prop, { release_date: { date } }, {})['Release Date']?.date?.start;

	it('fills a year-only date to the last day of the year', () => {
		assert.equal(dateFor('2023'), '2023-12-31');
	});

	it('fills a month-and-year date to the first of the month', () => {
		assert.equal(dateFor('March 2023'), '2023-03-01');
	});

	it('keeps a full day-month-year date', () => {
		assert.equal(dateFor('13 Mar, 2023'), '2023-03-13');
	});

	it('leaves the properties unchanged for an unparseable date or when disabled', () => {
		assert.deepEqual(getGameReleaseDate(prop, { release_date: { date: 'To be announced' } }, {}), {});
		assert.deepEqual(getGameReleaseDate({ ...prop, enabled: false }, { release_date: { date: '2023' } }, {}), {});
		assert.deepEqual(getGameReleaseDate(prop, {}, {}), {});
	});
});

describe('getGameStorePage', () => {
	it('builds the store URL from the App ID', () => {
		const out = getGameStorePage({ enabled: true, notionProperty: 'Store Page' }, 1145360, {});
		assert.equal(out['Store Page'].url, 'https://store.steampowered.com/app/1145360');
	});
});

describe('getGamePrice', () => {
	const prop = { enabled: true, notionProperty: 'Price' };

	it('converts the integer price to a decimal', () => {
		assert.equal(getGamePrice(prop, { price_overview: { initial: 1999 } }, {}).Price.number, 19.99);
	});

	it('keeps a zero price (free game) rather than dropping it', () => {
		assert.equal(getGamePrice(prop, { price_overview: { initial: 0 } }, {}).Price.number, 0);
	});

	it('leaves the properties unchanged when no price is available', () => {
		assert.deepEqual(getGamePrice(prop, {}, {}), {});
		assert.deepEqual(getGamePrice(prop, { price_overview: {} }, {}), {});
	});
});

describe('getSteamDeckCompatibility', () => {
	const prop = { enabled: true, notionProperty: 'Steam Deck' };
	const categoryTo = (category) => getSteamDeckCompatibility(prop, { steam_deck_compatibility: { category } }, {})['Steam Deck'].select.name;

	it('maps the category codes to their labels', () => {
		assert.equal(categoryTo('1'), 'Unsupported');
		assert.equal(categoryTo('2'), 'Playable');
		assert.equal(categoryTo('3'), 'Verified');
	});

	it('falls back to Unknown for a missing or unrecognized category', () => {
		assert.equal(categoryTo('99'), 'Unknown');
		assert.equal(getSteamDeckCompatibility(prop, {}, {})['Steam Deck'].select.name, 'Unknown');
	});
});

describe('getGameDevelopers and getGamePublishers', () => {
	it('map an array of names to a multi_select', () => {
		const dev = getGameDevelopers({ enabled: true, notionProperty: 'Developers' }, { developers: ['Supergiant Games'] }, {});
		assert.deepEqual(dev.Developers.multi_select, [{ name: 'Supergiant Games' }]);
		const pub = getGamePublishers({ enabled: true, notionProperty: 'Publishers' }, { publishers: ['A', 'B'] }, {});
		assert.deepEqual(pub.Publishers.multi_select, [{ name: 'A' }, { name: 'B' }]);
	});

	it('leave the properties unchanged when the list is absent', () => {
		assert.deepEqual(getGameDevelopers({ enabled: true, notionProperty: 'Developers' }, {}, {}), {});
		assert.deepEqual(getGamePublishers({ enabled: true, notionProperty: 'Publishers' }, {}, {}), {});
	});
});

describe('getGameDescription', () => {
	const prop = { enabled: true, notionProperty: 'Description' };

	it('passes a short description through', () => {
		assert.equal(getGameDescription(prop, { short_description: 'A rogue-like dungeon crawler.' }, {}).Description.rich_text[0].text.content, 'A rogue-like dungeon crawler.');
	});

	it('truncates a description to 2000 characters (Notion limit)', () => {
		const out = getGameDescription(prop, { short_description: 'x'.repeat(3000) }, {});
		assert.equal(out.Description.rich_text[0].text.content.length, 2000);
	});

	it('leaves the properties unchanged when there is no description', () => {
		assert.deepEqual(getGameDescription(prop, {}, {}), {});
	});
});

describe('getGameCoverImage', () => {
	const prop = { enabled: true, default: 'https://example.com/default.jpg' };

	it('prefers the Steam Store header image', () => {
		const out = getGameCoverImage(prop, { header_image: 'https://cdn/direct.jpg' }, null);
		assert.equal(out.external.url, 'https://cdn/direct.jpg');
	});

	it('builds a URL from the SteamUser header image when the store one is absent', () => {
		const out = getGameCoverImage(prop, null, { gameid: '1145360', header_image: { english: 'header.jpg' } });
		assert.equal(out.external.url, 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/header.jpg');
	});

	it('falls back to the configured default image', () => {
		assert.equal(getGameCoverImage(prop, null, null).external.url, 'https://example.com/default.jpg');
	});

	it('returns null when disabled', () => {
		assert.equal(getGameCoverImage({ ...prop, enabled: false }, { header_image: 'x' }, null), null);
	});
});

describe('getGameIcon', () => {
	const prop = { enabled: true, default: 'https://example.com/icon.png' };

	it('builds the icon URL from the SteamUser data', () => {
		const out = getGameIcon(prop, { gameid: '1145360', icon: 'abc123' });
		assert.equal(out.external.url, 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1145360/abc123.jpg');
	});

	it('falls back to the configured default icon', () => {
		assert.equal(getGameIcon(prop, {}).external.url, 'https://example.com/icon.png');
	});

	it('returns null when disabled', () => {
		assert.equal(getGameIcon({ ...prop, enabled: false }, { icon: 'x' }), null);
	});
});
