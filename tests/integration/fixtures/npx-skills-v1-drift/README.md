# Real-world fixture: a version 1 lock and its copy drifted apart

Taken on 2026-11-22 from a public project that installs skills with `npx skills`
(lock version 1) and commits them:

- `project/skills-lock.json`: the project's real lock entry for `grilling`
  (other entries removed). Its `computedHash` matches upstream commit 95249b0 (2026-10-07).
- `project/.agents/skills/grilling/`: the copy committed in that project, which is
  byte-for-byte upstream commit 85f83d3 (2026-08-20). Nothing was edited; the copy is
  simply older than the lock says.
- `upstream/`: the folder `skills/productivity/grilling` of
  https://github.com/mattpocock/skills at its three most recent commits (7739eae is the
  latest), and `commits.json`, the GitHub list-commits response for that folder
  (trimmed to sha and committer date).

The skill files are by Matt Pocock, used under the MIT License below.

```
MIT License

Copyright (c) 2026 Matt Pocock

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
```
