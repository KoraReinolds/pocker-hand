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
    // this._givePots = injections.givePots
  }

  private _seats: Seat[]
  private _seatIndex = 0
  private _startWith = 0
  
  private _foldPlayers: string[] = []
  
  private _gameConfig: GameConfigType
  private _makeDeck: () => string[]
  private _sleep: (ms: number) => Promise<unknown>
  private _communityCards: string[] = []
  private _holeCards: Record<string, [string, string]> = {}
  private _pots: { potId: string, amount: number }[] = []
  private _bets: Record<string, number> = {}
  private _minRaise: number = 0
  private _deck: string[] = []
  private _deckPointer: number = 0
  private _betOrFold: Set<string> = new Set()

  private _dealCards(deck: string[], seats: Seat[]) {
    return Object.fromEntries(
      seats.map((s, i) => [s.playerId, deck.splice(i*2, 2) as [string, string]])
    )
  }
  
  private _bet(playerId: string, bet: number) {
    if (!this._bets[playerId]) this._bets[playerId] = 0
    
    this._bets[playerId] += bet
    this._minRaise = Math.max(this._bets[playerId] || 0, this._minRaise)
  }

  private _fold(playerId: string) {
    this._foldPlayers.push(playerId)
  }

  private _getSeat(): Seat {
    return this._seats[this._seatIndex] as Seat
  }

  private _nextSeat(): Seat {
    this._seatIndex = (this._seatIndex + 1) % this._seats.length
    const seat: Seat = this._getSeat()
    return (this._foldPlayers.includes(seat.playerId))
      ? this._nextSeat()
      : seat
  }

  private _openCards(communityCards: string[], cards: string[]) {
    return [...communityCards, ...cards]
  }
  
  private _isBetsEqual() {
    const betsInPlay = Object.entries(this._bets)
      .filter(([id]) => !this._foldPlayers.includes(id))
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
  start(): void {
    this._deck = this._makeDeck()

    this._holeCards = this._dealCards(this._deck, this._seats)
    this._deckPointer = this._seats.length * 2 + 1

    this._seatIndex = this._seats.length === 2 ? -1 : 0
    this._bet(this._nextSeat().playerId, this._gameConfig.smallBlind)
    this._bet(this._nextSeat().playerId, this._gameConfig.bigBlind)
    this._startWith = this._seatIndex
    this._minRaise = this._gameConfig.bigBlind
  }
  private _resetBets() {
    Object.keys(this._bets).forEach(key => this._bets[key] = 0)
  }
  private _flop() {
    this._communityCards = this._openCards(this._communityCards, this._deck.splice(this._deckPointer, 3) as string[])
    this._deckPointer += 3
    this._seatIndex = 0
    this._minRaise = this._gameConfig.bigBlind
    this._resetBets()
  }
  act(playerId: string, action: PlayerAction): void {
    if (this._nextSeat().playerId !== playerId) {
      throw new Error("Cant't act")
    }
    if (action.type === 'bet') {
      if (this.isValidBet(playerId, action.amount)) {
        this._bet(playerId, action.amount)
      }
    } else {
      this._fold(playerId)
    }
    this._betOrFold.add(playerId)

    if ((this._betOrFold.size >= this._seats.length)
      && this._isBetsEqual()
    ) {
      if (this._communityCards.length === 0) this._flop()
    } 
  }
  isValidBet(playerId: string, amount: number): boolean {
    const seat = this.getSeatByPlayerId(playerId)
    const sum = amount + (this._bets[playerId] || 0)

    console.log(playerId, amount, sum, this._minRaise)
    if (seat && (
      amount <= seat.stack &&
      (sum === this._minRaise
      || sum >= (this._minRaise * 2))
    )) {
      return true
    } else {
      return false
    }
  }
  getSeatByPlayerId(playerId: string): Seat | undefined {
    return this._seats.find(s => s.playerId === playerId)
  }
}
