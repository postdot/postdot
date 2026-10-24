# Local incident or alpha feedback report

Use a private working location chosen for the deployment. Combine observations
about one underlying failure rather than generating duplicate issues.

```markdown
# Short symptom and affected workflow

- Version/digest, architecture and environment:
- Time observed (with timezone):
- User intent / expected result:
- Actual result and impact:
- Minimal reproduction:
- Sanitized evidence (status/code, selected IDs, bounded logs):
- Confirmed or possible external effects:
- Hypothesis and confidence; alternative explanation:
- Workaround or change attempted and its scope:
- Verification afterward:
- Not tested / remaining uncertainty:
- Suggested next investigation:
```

Do not fill unknown values with guesses. A logged error is evidence of that error,
not proof of root cause. If a workaround makes the task usable, still record the
original failure. Preserve relevant evidence before changing state.

A debug/alpha request permits attentive observation and reporting within scope;
it is not authorization for destructive probes or public disclosure. If a report
should become a GitHub issue, show a sanitized draft and submit only when the
user requests submission. Do not send private hostnames, customer content or
credentials to external services as part of routine feedback.
