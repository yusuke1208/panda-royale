/* 既存 roll に追加 */
exports.roll = (type) => {
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
      // 1,3,5,7,9
      const odds = [1, 3, 5, 7, 9];
      return odds[Math.floor(Math.random() * odds.length)];
    }
    case "pink": {
      // 2,4,6,8,10
      const evens = [2, 4, 6, 8, 10];
      return evens[Math.floor(Math.random() * evens.length)];
    }
    case "gold":
      return 20; // 常に 20
    default:
      return 0;
  }
};
