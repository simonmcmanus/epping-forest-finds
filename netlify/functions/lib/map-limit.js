// Runs `fn` over `items` with at most `limit` calls in flight, keeping results in input order.
// Blob reads were fanned out with a bare Promise.all, so a store of tens of thousands of records
// opened tens of thousands of requests at once; this keeps a function inside its socket and time
// limits however large the store grows.
async function mapLimit(items, limit, fn) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  return results;
}

module.exports = { mapLimit };
