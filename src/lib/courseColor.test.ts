import { describe, it, expect } from 'vitest';
import { courseColor, COURSE_COLORS } from './courseColor';

describe('courseColor', () => {
	it('always returns a key the palette defines', () => {
		const names = ['MATH 221', 'BIO 101', 'HIST 110', 'Other', '', 'a'.repeat(200)];
		for (const name of names) {
			expect(COURSE_COLORS).toContain(courseColor(name));
		}
	});

	it('never spends ember on a course, leaving it to mean urgency', () => {
		expect(COURSE_COLORS).not.toContain('ember');
	});

	it('gives the same course the same color every time', () => {
		expect(courseColor('MATH 221')).toBe(courseColor('MATH 221'));
	});

	it('ignores surrounding whitespace and case', () => {
		expect(courseColor('  math 221 ')).toBe(courseColor('MATH 221'));
	});

	it('does not depend on what other courses exist', () => {
		// The whole point of hashing over round-robin assignment: adding a class
		// must not recolor the ones already on screen.
		const before = courseColor('BIO 101');
		void courseColor('CHEM 200');
		expect(courseColor('BIO 101')).toBe(before);
	});

	it('spreads a realistic course load across several colors', () => {
		const courses = ['MATH 221', 'BIO 101', 'HIST 110', 'ENGL 205', 'CS 250'];
		const used = new Set(courses.map(courseColor));
		expect(used.size).toBeGreaterThan(1);
	});
});
