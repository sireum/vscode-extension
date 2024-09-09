/*
MIT License

Copyright (c) 2017 JeanPaul Attard

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// Adapted from: https://github.com/jeanpaulattard/json-to-properties/blob/e15a9649b7ce152a26adebcab38396b2ef3c1133/src/scripts/parser.js
export function deflate(json: Record<string, any>, prefix?: string): string[] {
  let result: string[] = [];
  const keys: string[] = Object.keys(json);
  keys.forEach((key: string) => {
    let _prefix: string;

    if (json[key] && typeof json[key] === "object") {
      const _currPrefix: string = key.concat(".");
      _prefix = prefix ? prefix.concat(_currPrefix) : _currPrefix;
      result = result.concat(deflate(json[key], _prefix));
    } else {
      _prefix = prefix ? prefix.concat(key) : key;
      result.push(_prefix.concat("=").concat(json[key] || ""));
    }
  });

  return result;
}
