/**
 * ダイスロール関数 (ES Module版)
 * server/util/dice.js から移植
 */
export function roll(type) {
  switch (type) {
    case "yellow":
      return 1 + Math.floor(Math.random() * 6); // 1-6
    case "purple":
      return 1 + Math.floor(Math.random() * 6); // 1-6
    case "red":
      return 1 + Math.floor(Math.random() * 6); // 1-6
    case "green":
      return 1 + Math.floor(Math.random() * 20); // 1-20
    case "blue": {
      const odds = [1, 3, 5, 7, 9];
      return odds[Math.floor(Math.random() * odds.length)];
    }
    case "pink": {
      const evens = [2, 4, 6, 8, 10];
      return evens[Math.floor(Math.random() * evens.length)];
    }
    case "rainbow":
      return 20; // 常に 20
    default:
      return 0;
  }
}
