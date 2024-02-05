import {
  CardGroup,
  OddsCalculator,
  type Card as PokerToolsCard,
} from "poker-tools";

// Готовая функция для перемешивания колоды
export function shuffle<T>(array: Array<T>) {
  let currentIndex = array.length,
    randomIndex

  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex--;

    // @ts-expect-error This is fine.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ]
  }

  return array
}

// Функция сна
// Спать надо
// * на 1 секунду - после раздачи карт игрокам
// * на 1 секунду - после раздачи 3х карт на стол
// * на 1 секунду - после раздачи 4й карты на стол
// * на 1 секунду - после раздачи 5й карты на стол
// * на 1 секунду - после раздачи каждого выигрыша
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Card = string
type PlayerAction =
  | {
      type: "fold"
    }
  | {
      type: "bet"
      amount: number
    }

// Функция генерации новой колоды
// Возвращает массив из 52 карт
// Каждая карта - строка из 2х символов
// Первый символ - номер карты
// Второй символ - масть карты
function generateNewDeck() {
  const suits = "hdcs"
  const numbers = "A23456789TJQK"

  const deck = [...suits]
    .map((suit) => [...numbers].map((number) => `${number}${suit}`))
    .flat()

  return shuffle(deck)
}

type PlayerId = string
type GameConfigType = {
  smallBlind: number
  bigBlind: number
  antes: number
  timeLimit: number
}
// type Pot = {
//   potId: string
//   amount: number
//   eligiblePlayers: Set<PlayerId>
// }
type Seat = {
  playerId: PlayerId
  stack: number
}
type CurrencyType = number

export interface HandInterface {
  getState(): {
    // Карты на столе
    communityCards: Card[]
    // Карты игроков
    holeCards: Record<PlayerId, [Card, Card]>
    // Банки на столе. potId - произвольный уникальный идентификатор
    pots: { potId: string; amount: number }[]
    // Ставки игроков в текущем раунде
    bets: Record<PlayerId, number>
    // На сколько игроки должны поднять ставку, чтобы сделать минимальный рейз
    minRaise: CurrencyType
  }
  start(): void
  // Генерирует исключение если игрок пробует походить не  в свой ход
  act(playerId: PlayerId, action: PlayerAction): void
  isValidBet(playerId: PlayerId, amount: number): boolean
  getSeatByPlayerId(playerId: PlayerId): Seat | undefined
}

export class Hand implements HandInterface {
  constructor(
    // Игроки за столом. Первый игрок - дилер
    // Можете считать что у всех игроков есть хотя бы 1 фишка
    seats: Seat[],
    gameConfig: GameConfigType,
    injections: {
      // Функция генерации колоды, значение по умолчанию - generateNewDeck
      makeDeck?: () => string[]
      // Функция сна, значение по умолчанию - sleep
      sleep?: (ms: number) => Promise<unknown>
      // Функция вызываемая когда надо выдать банк игрокам
      givePots?: (winners: {
        // Идентификаторы игроков которые выиграли этот банк
        playerIds: PlayerId[]
        // Карты, благодаря которым банк выигран (они подсвечиваются при выигрыше)
        winningCards: Card[]
        // Уникальный идентификатор банка
        potId: string
      }) => void
    } = {}
  ) {
    this._seats = seats
    this._gameConfig = gameConfig
    this._makeDeck = injections.makeDeck || generateNewDeck
    this._sleep = injections.sleep || sleep
    this._givePots = injections.givePots
  }

  private _givePots: Function | undefined

  private _seats: Seat[]
  private _seatIndex = 0
  private _startWith = 0
  
  private _foldPlayers: string[] = []
  
  private _gameConfig: GameConfigType
  private _makeDeck: () => string[]
  private _sleep: (ms: number) => Promise<unknown>
  private _communityCards: string[] = []
  private _holeCards: Record<string, [string, string]> = {}
  private _pots: { potId: string, amount: number }[] = [{ potId: '1', amount: 0 }]
  private _bets: Record<string, number> = {}
  private _minRaise: number = 0
  private _deck: string[] = []
  private _deckPointer: number = 0
  private _betSet: Set<string> = new Set()
  private _foldSet: Set<string> = new Set()
  private _allInSet: Set<string> = new Set()

  private _dealCards(deck: string[], seats: Seat[]) {
    return Object.fromEntries(
      seats.map((s, i) => [s.playerId, deck.slice(i*2, i*2 + 2) as [string, string]])
    )
  }
  
  private _bet(playerId: string, bet: number) {
    const seat = this.getSeatByPlayerId(playerId)
    if (seat) {
      seat.stack -= bet
      if (!seat.stack) this._allInSet.add(playerId)
      else this._betSet.add(playerId);
      (this._pots[0] as { amount: number }).amount += bet 
    }
    if (!this._bets[playerId]) this._bets[playerId] = 0
    
    this._minRaise = Math.max(bet - (this._bets[playerId] || 0), this._minRaise)
    this._bets[playerId] += bet
  }

  private _getSeat(): Seat {
    return this._seats[this._seatIndex] as Seat
  }

  private _nextSeat(): Seat {
    this._seatIndex = (this._seatIndex + 1) % this._seats.length
    const seat: Seat = this._getSeat()
    return (this._foldSet.has(seat.playerId) || this._allInSet.has(seat.playerId))
      ? this._nextSeat()
      : seat
  }

  private _openCards(communityCards: string[], cards: string[]) {
    return [...communityCards, ...cards]
  }
  
  private _isBetsEqual() {
    const betsInPlay = Object.entries(this._bets)
      .filter(([id]) => !this._foldSet.has(id))
      .map(([_, bet]) => bet)
    return betsInPlay[0] === (betsInPlay.reduce((sum, cur) => sum + cur) / betsInPlay.length)
  }

  getState(): {
    communityCards: string[]
    holeCards: Record<string, [string, string]>
    pots: { potId: string, amount: number }[]
    bets: Record<string, number>
    minRaise: number
  } {
    return {
      communityCards: this._communityCards,
      holeCards: this._holeCards,
      pots: this._pots,
      bets: this._bets,
      minRaise: this._minRaise
    }
  }
  private _resetSeatIndex() {
    this._seatIndex = this._seats.length === 2 ? -1 : 0
  }
  start(): void {
    this._deck = this._makeDeck()

    this._holeCards = this._dealCards(this._deck, this._seats)
    this._deckPointer = this._seats.length * 2

    this._resetSeatIndex()
    this._bet(this._nextSeat().playerId, this._gameConfig.smallBlind)
    this._bet(this._nextSeat().playerId, this._gameConfig.bigBlind)
    this._betSet = new Set()
    this._startWith = this._seatIndex
    this._minRaise = this._gameConfig.bigBlind
  }
  private _resetBets() {
    Object.keys(this._bets).forEach(key => this._bets[key] = 0)
    this._betSet = new Set()
  }
  private _flop() {
    this._communityCards = this._openCards(this._communityCards, this._deck.slice(this._deckPointer, this._deckPointer + 3) as string[])
    this._deckPointer += 3
    this._resetSeatIndex()
    this._minRaise = this._gameConfig.bigBlind
    this._resetBets()
  }
  private _turn() {
    this._communityCards = this._openCards(this._communityCards, this._deck.slice(this._deckPointer, this._deckPointer + 1) as string[])
    this._deckPointer += 1
    this._resetSeatIndex()
    this._minRaise = this._gameConfig.bigBlind
    this._resetBets()
  }
  private _river() {
    this._communityCards = this._openCards(this._communityCards, this._deck.slice(this._deckPointer, this._deckPointer + 1) as string[])
    this._deckPointer += 1
    this._resetSeatIndex()
    this._minRaise = this._gameConfig.bigBlind
    this._resetBets()
  }
  private _showdown() {
    const { holeCards, communityCards } = this.getState()
    const playersCards = Object.values(holeCards).map(playerCards => CardGroup.fromString(playerCards.join('')) as [Card, Card])
    const board = CardGroup.fromString(communityCards.join(''))
    
    const result = OddsCalculator.calculateWinner(playersCards, board)
   
    Object.keys(this._pots).map(potId => {
      this._givePots?.({
        potId,
        playerIds: (result[0] || [])
          .map(({ index }) => this._seats[index]?.playerId),
        winningCards: [...new Set(
          (result[0] || [])
            .map(({ handrank: { highcards: { cards } } }) => cards.map(c => c.toString())).flat()
        )].sort()
      })
    })
  }
  act(playerId: string, action: PlayerAction): void {
    if (this._nextSeat().playerId !== playerId) {
      throw new Error("Can't act")
    }
    if (action.type === 'bet') {
      if (this.isValidBet(playerId, action.amount)) {
        this._bet(playerId, action.amount)
      }
    } else {
      this._foldSet.add(playerId)
    }

    if (this._allInSet.size + 1 === this._seats.length) {
      if (this._communityCards.length === 0) this._flop()
      if (this._communityCards.length === 3) this._turn()
      if (this._communityCards.length === 4) this._river()
      if (this._communityCards.length === 5) this._showdown()
    }

    if ((
      (new Set([
      ...this._foldSet,
      ...this._betSet,
      ...this._allInSet
    ])).size >= this._seats.length)
      && this._isBetsEqual()
    ) {
      if (this._communityCards.length === 0) this._flop()
      else if (this._communityCards.length === 3) this._turn()
      else if (this._communityCards.length === 4) this._river()
      else if (this._communityCards.length === 5) this._showdown()
    } 
  }
  isValidBet(playerId: string, amount: number): boolean {
    const seat = this.getSeatByPlayerId(playerId);
  
    if (seat && seat.stack > 0) {
      const call = this._minRaise - (this._bets[playerId] || 0)
  
      if (amount === seat.stack) {
        // Player is going All-In, any amount up to their entire stack is valid
        return true;
      } else if (amount < seat.stack) {
        const totalOtherBets = Object.values(this._bets)
          .reduce((total, bet) => total + bet, 0);

        const maxBet = Math.max(...Object.values(this._bets))
        const allInsLessMaxBet = [...this._allInSet].every(id => (this._bets[id] || 0) < maxBet) && maxBet > this._gameConfig.bigBlind
            
        if (
          (this._allInSet.size === 0
            || (
              this._allInSet.size > 0
              && allInsLessMaxBet
            )
          ) && (
            amount === call 
            || amount >= call * 2 
            || (amount === 0 && totalOtherBets === 0)
          )
        ) {
          return true;
        } else if (this._allInSet.size > 0 && !allInsLessMaxBet) {
          // Other players have gone All-In, so any bet is valid
          return true;
        }
      }
    }
  
    return false;
  }
  getSeatByPlayerId(playerId: string): Seat | undefined {
    return this._seats.find(s => s.playerId === playerId)
  }
}
