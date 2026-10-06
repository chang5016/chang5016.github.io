export function completeDriverTrip(comfort: number, remaining: number, streak: number) {
  const excellent = comfort >= 85 && remaining > 0;
  const nextStreak = excellent ? streak + 1 : 0;
  const bonus = excellent ? 25 + Math.min(nextStreak, 5) * 10 : 0;
  return { streak: nextStreak, bonus, grade: excellent ? "S" : comfort >= 65 ? "A" : "B" };
}

export function driverRank(trips: number) {
  return trips >= 20 ? "海灣王牌" : trips >= 10 ? "城市達人" : trips >= 3 ? "熟路司機" : "新手司機";
}
