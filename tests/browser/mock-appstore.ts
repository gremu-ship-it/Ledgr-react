/**
 * R09.4 stand-in for '@/store/useAppStore'. Zustand-shaped callable with
 * getState/setState: the offline capture path reads `currentUser?.id`
 * (provenance) and `useOfflineQueue` reads `currentBusiness?.business.id`
 * (queue scoping). Harness scenarios drive both explicitly — exactly what a
 * hydrated session would supply; no identity is fabricated for the SERVER
 * (server-side actor checks remain DB/FIXTURE-layer evidence).
 */
interface MockBusiness { business: { id: string } }
interface MockState {
  currentUser: { id: string } | null;
  currentBusiness: MockBusiness | null;
}
const state: MockState = { currentUser: null, currentBusiness: null };

type Selector<T> = (s: MockState) => T;

function useAppStoreImpl<T>(selector?: Selector<T>): T | MockState {
  return selector ? selector(state) : state;
}
useAppStoreImpl.getState = () => state;
useAppStoreImpl.setState = (partial: Partial<MockState>) => { Object.assign(state, partial); };
useAppStoreImpl.subscribe = () => () => {};

export const useAppStore = useAppStoreImpl as unknown as {
  <T>(selector?: Selector<T>): T; getState: () => MockState; setState: (p: Partial<MockState>) => void; subscribe: () => () => void;
};

export function r094SetCurrentUser(id: string | null) {
  state.currentUser = id ? { id } : null;
}
export function r094SetCurrentBusiness(id: string | null) {
  state.currentBusiness = id ? { business: { id } } : null;
}
