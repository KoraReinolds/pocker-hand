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

test("invalid Bet", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  expect(
    [1, 19, 21, 39]
      .map(bet => hand.isValidBet('a', bet))
      .every(res => res === false)
    ).toBe(true);

  expect(
    [1, 19]
      .map(bet => hand.isValidBet('c', bet))
      .every(res => res === false)
    ).toBe(true);
});

test("valid Bet", async () => {
  const { hand } = await makeHand([player("a"), player("b"), player("c")]);

  expect(
    [20, 40, 41]
      .map(bet => hand.isValidBet('a', bet))
      .every(res => res === true)
    ).toBe(true);

  expect(
    [0, 20]
      .map(bet => hand.isValidBet('c', bet))
      .every(res => res === true)
    ).toBe(true);
});
