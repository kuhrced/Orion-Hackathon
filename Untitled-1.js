function findPrimes(limit) {
  const isPrime = Array(limit + 1).fill(true);
  isPrime[0] = false;
  isPrime[1] = false;

  for (let number = 2; number * number <= limit; number += 1) {
    if (isPrime[number]) {
      for (let multiple = number * number; multiple <= limit; multiple += number) {
        isPrime[multiple] = false;
      }
    }
  }

  return isPrime
    .map((prime, number) => (prime ? number : null))
    .filter((number) => number !== null);
}

const primes = findPrimes(100);
console.log('Prime numbers from 1 to 100:');
console.log(primes.join(', '));
console.log(`Found ${primes.length} prime numbers.`);
