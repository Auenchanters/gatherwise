/**
 * Setup for the jsdom UI tests: unmount whatever a test rendered, so tests never share a DOM, and
 * give async queries (`findBy*`, `waitFor`) five seconds instead of one. A whole workspace is a
 * few hundred elements, and on a busy machine the first render after a lazy import can pass the
 * one-second default; waiting longer never makes a passing test fail.
 * Never does: add globals or matchers; tests import what they use.
 */
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);
