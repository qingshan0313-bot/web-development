// Copy editable data while retaining references to files, blobs and decoded images.
export function copyUndoState(value) {
  if (Array.isArray(value)) return value.map(copyUndoState);
  if (value instanceof Map)
    return new Map([...value].map(([key, item]) => [key, copyUndoState(item)]));
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, copyUndoState(item)]),
    );
  return value;
}

function sameState(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || Object.getPrototypeOf(left) !== Object.getPrototypeOf(right))
    return false;
  if (left instanceof Map)
    return left.size === right.size &&
      [...left].every(([key, value]) => right.has(key) && sameState(value, right.get(key)));
  if (Array.isArray(left) || Object.getPrototypeOf(left) === Object.prototype) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && sameState(left[key], right[key]));
  }
  return false;
}

export function createUndoHistory(limit = 50) {
  const entries = [];
  let mergeKey = null;
  return {
    get latest() { return entries.at(-1); },
    breakGroup() { mergeKey = null; },
    record(tool, before, after, key) {
      if (sameState(before, after)) return;
      const previous = entries.at(-1);
      if (key && key === mergeKey && previous?.tool === tool) {
        if (sameState(previous.before, after)) entries.pop();
      } else {
        entries.push({ tool, before });
        if (entries.length > limit) entries.shift();
      }
      mergeKey = key || null;
    },
    pop() {
      mergeKey = null;
      return entries.pop();
    },
  };
}
