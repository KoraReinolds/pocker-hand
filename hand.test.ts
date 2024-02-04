import { expect, test, vi, describe } from "vitest";
import { Hand, type HandInterface } from "./hand";

const player = (name: string, stack: number = 1000) => ({
  playerId: name,
  stack,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeHand = (
  s: ReturnType<typeof player>[],
  deck?: string | null,
  gameConfig = {
    smallBlind: 10,
    bigBlind: 20,
    antes: 0,
    timeLimit: 10,
  }
) => {
  const listener = vi.fn();
  const hand: HandInterface = new Hand(s, gameConfig, {
    sleep: () => Promise.resolve(null),
    ...(deck ? { makeDeck: () => deck.match(/.{1,2}/g)! } : {}),
    givePots: listener,
  });
  hand.start();
  return tick().then(() => ({ hand, listener }));
};

const act = (
  hand: HandInterface,
  playerId: string,
  action: Parameters<HandInterface["act"]>[1]
) => {
  hand.act(playerId, action);
  return tick();
};

const allIn = async (hand: HandInterface, playerId: string) => {
  await act(hand, playerId, {
    type: "bet",
    amount: hand.getSeatByPlayerId(playerId)!.stack,
  });
};

const pots = (hand: HandInterface) => hand.getState().pots.map((p) => p.amount);

test("gets small and big blind from players", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);
  expect(hand.getState().bets).toEqual({ b: 10, c: 20 });
});

test("proceeds to flop if BB checks", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "fold" });
  expect(hand.getState().communityCards).toEqual([]);
  await act(hand, "c", { type: "bet", amount: 0 });
  expect(hand.getState().communityCards.length).toBe(3);
});

test("continues turn if BB raises", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "fold" });
  expect(hand.getState().communityCards).toEqual([]);
  await act(hand, "c", { type: "bet", amount: 20 });
  expect(hand.getState().communityCards.length).toBe(0);
});

test("checking through proceeds to flop", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);
  await act(hand, "a", { type: "bet", amount: 20 });
  await act(hand, "b", { type: "bet", amount: 10 });
  await act(hand, "c", { type: "bet", amount: 0 });
  expect(hand.getState().communityCards.length).toBe(3);
});

test("invalid raise", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 60 });

  expect(hand.isValidBet("b", 45)).toBe(false);
  expect(hand.isValidBet("b", 50)).toBe(true);
});

test("skipping SB due to all-in", async () => {
  const { hand } = await makeHand([player("a", 15), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 15 });
  await act(hand, "b", { type: "bet", amount: 5 });

  expect(hand.getState().bets).toEqual({ a: 15, b: 15, c: 20 });
});

test("pot-sized raises", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 60 });

  // call
  await act(hand, "b", { type: "bet", amount: 50 });

  // A raised from 20 (BB) to 60, so minimum raise is 60-20 = 40 over 60
  expect(hand.isValidBet("c", 79)).toBe(false);
  expect(hand.isValidBet("c", 80)).toBe(true);
});

test("re-raises", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  await act(hand, "a", { type: "bet", amount: 40 });
  await act(hand, "b", { type: "bet", amount: 70 });
  await act(hand, "c", { type: "bet", amount: 100 });
});

test("correctly pays at fold", async () => {
  const { hand } = await makeHand([player("a"), player("b")]);

  await allIn(hand, "a");
  await act(hand, "b", { type: "fold" });
});

test("correctly handles huge raise", async () => {
  const { hand, listener } = await makeHand([
    player("a", 50000),
    player("b", 50000),
  ]);

  await act(hand, "a", { type: "bet", amount: 25000 });
  expect(hand.getState().minRaise).toBe(24990);
});

