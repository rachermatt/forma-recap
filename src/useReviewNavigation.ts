import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { DEFAULT_REVIEW_ROUTE, parseReviewHash, serializeReviewRoute } from './reviewNavigation';
import type { ReviewRoute } from './reviewNavigation';

export type LeaveGuard = (() => Promise<boolean>) | null;
type Options = { replace?: boolean; skipGuard?: boolean };
const indexOf = (state: unknown): number | null => state && typeof state === 'object' && Number.isInteger((state as Record<string, unknown>).formaReviewIndex) ? (state as { formaReviewIndex: number }).formaReviewIndex : null;

/** URL navigation carries review references, while a draft stays owned by its exact editor key. */
export function useReviewNavigation(guard: MutableRefObject<LeaveGuard>) {
  const initial = useRef(parseReviewHash(window.location.hash));
  const [route, setRoute] = useState<ReviewRoute>(initial.current.ok ? initial.current.route : { ...DEFAULT_REVIEW_ROUTE });
  const [routeError, setRouteError] = useState(initial.current.ok ? '' : initial.current.error);
  const current = useRef(route);
  const currentIndex = useRef(indexOf(window.history.state) ?? 0);
  const restoring = useRef(false);
  const pending = useRef(false);
  const pendingPop = useRef(false);
  current.current = route;

  const commit = useCallback((next: ReviewRoute, replace: boolean) => {
    const hash = serializeReviewRoute(next);
    const index = currentIndex.current + (replace ? 0 : 1);
    const state = { ...window.history.state, formaReviewIndex: index };
    window.history[replace ? 'replaceState' : 'pushState'](state, '', hash);
    currentIndex.current = index;
    current.current = next;
    setRoute(next);
    setRouteError('');
  }, []);

  // Back/Forward moves the browser before asking the guard. Always resolve against
  // its latest position, including further presses while the same dialog is open.
  const restoreCurrent = useCallback(() => {
    const actualIndex = indexOf(window.history.state);
    if (actualIndex !== null && actualIndex !== currentIndex.current) {
      restoring.current = true;
      window.history.go(currentIndex.current - actualIndex);
    } else {
      window.history.replaceState({ ...window.history.state, formaReviewIndex: currentIndex.current }, '', serializeReviewRoute(current.current));
    }
  }, []);

  const acceptCurrentLocation = useCallback(() => {
    const parsed = parseReviewHash(window.location.hash);
    currentIndex.current = indexOf(window.history.state) ?? currentIndex.current + 1;
    window.history.replaceState({ ...window.history.state, formaReviewIndex: currentIndex.current }, '', window.location.href);
    if (parsed.ok) {
      current.current = parsed.route;
      setRoute(parsed.route);
      setRouteError('');
      if (parsed.redirected) commit(parsed.route, true);
    } else setRouteError(parsed.error);
  }, [commit]);

  const navigate = useCallback(async (patch: Partial<ReviewRoute>, options: Options = {}) => {
    if (pending.current || restoring.current) return false;
    const before = current.current;
    const base = patch.workspace && patch.workspace !== before.workspace
      ? { ...DEFAULT_REVIEW_ROUTE, page: before.page, section: before.section }
      : before;
    const next = { ...base, ...patch } as ReviewRoute;
    if (serializeReviewRoute(next) === window.location.hash && !routeError) return true;
    pending.current = true;
    pendingPop.current = false;
    try {
      if (!options.skipGuard && guard.current && !await guard.current()) {
        if (pendingPop.current) restoreCurrent();
        return false;
      }
      if (pendingPop.current) acceptCurrentLocation();
      else commit(next, !!options.replace);
      return true;
    } finally { pending.current = false; pendingPop.current = false; }
  }, [acceptCurrentLocation, commit, guard, restoreCurrent, routeError]);

  // Loading labels/default selection can enrich the current URL without creating extra Back stops.
  const remember = useCallback((patch: Partial<ReviewRoute>) => {
    const before = current.current;
    if (pending.current || restoring.current || routeError || (patch.workspace && patch.workspace !== before.workspace)) return;
    const next = { ...before };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && next[key as keyof ReviewRoute] === undefined) (next as Record<string, unknown>)[key] = value;
    }
    if (serializeReviewRoute(next) !== window.location.hash) commit(next, true);
  }, [commit, routeError]);

  useEffect(() => {
    if (initial.current.ok) commit(current.current, true);
    const pop = async () => {
      if (restoring.current) {
        restoring.current = false;
        restoreCurrent();
        return;
      }
      if (pending.current) { pendingPop.current = true; return; }
      pending.current = true;
      pendingPop.current = true;
      try {
        if (guard.current && !await guard.current()) { restoreCurrent(); return; }
        acceptCurrentLocation();
      } finally { pending.current = false; pendingPop.current = false; }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [acceptCurrentLocation, commit, guard, restoreCurrent]);

  return { route, routeError, navigate, remember };
}
