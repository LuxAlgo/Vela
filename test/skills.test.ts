// The agent skills both packages ship follow the Agent Skills specification, stay short enough
// to load whole, and point only at files that ship with their package.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a repo script, plain JavaScript
import { checkSkills, skillDirs } from '../scripts/check-skills.mjs';

describe('the agent skills', () => {
    it('are valid, and every file they point an agent at ships with its package', () => {
        expect(skillDirs().length).toBeGreaterThanOrEqual(6);
        expect(checkSkills()).toEqual([]);
    });
});
