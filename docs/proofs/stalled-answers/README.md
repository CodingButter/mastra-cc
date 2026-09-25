# Answers wait for a reader (ADR-0106 amendment)

`daemon/src/__tests__/answers-wait-for-a-reader.test.ts` connects a real Unix-socket client, stops reading, and pipelines 3,000 reads that each return 16 KB. It then checks two things: the peak bytes the daemon retains for that client, and that when the client reads again, every answer arrives in order.

- [without.txt](without.txt): the same test run against `master` code. It retained 49,170,922 bytes against a bound of 1,343,744.
- [with.txt](with.txt): the branch. Retained bytes stay under the bound, and all 3,000 answers arrive in order.
