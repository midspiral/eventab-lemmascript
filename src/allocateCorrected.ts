//@ backend dafny

//@ contract Splits total across weights so every unit is accounted for.
// whole units, e.g. cents
//@ requires total >= 0
//@ requires weights.length >= 1
//@ requires forall(k, 0 <= k && k < weights.length ==> weights[k] >= 0)
//@ requires sum(weights) >= 1
// must sum to the whole
//@ ensures sum(\result) === total
function allocate(total: number, weights: number[]): number[] {
  const W = sum(weights);
  const result = weights.map(w => Math.floor(total * w / W));
  const left = total - sum(result);  // the leftover, lost to flooring
  for (let k = 0; k < left; k++)
    result[k] = result[k] + 1;  // hand them back out
  return result;
}

// Keep the sum definition local so verification proves its implementation too.
export function sumTo(arr: number[], n: number): number {
  //@ requires 0 <= n && n <= arr.length
  //@ decreases n
  if (n === 0) return 0;
  return sumTo(arr, n - 1) + arr[n - 1];
}

export function sum(arr: number[]): number {
  return sumTo(arr, arr.length);
}
