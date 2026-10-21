/**
 * Setup for the jsdom UI tests: unmount whatever a test rendered, so tests never share a DOM.
 * Never does: add globals or matchers; tests import what they use.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
