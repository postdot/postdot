# Security policy

Postdot is a self-hosted application in an early stage: there is no stable release
yet, and only the current `main` branch is supported. Fixes land there.

## Reporting a vulnerability

Please report it privately through GitHub:
[report a vulnerability](https://github.com/postdot/postdot/security/advisories/new).
Do not open a public issue or discussion with the details.

It helps to include:

- what you found and where (route, screen, commit or version);
- the steps to reproduce it, and the impact you expect;
- anything specific to your setup, such as deployment mode or enabled providers.

If you cannot use GitHub for this, write to contact@postdot.app and ask for a
private channel, without the details of the problem at first.

## What to expect

Postdot is maintained by one person, so there is no service-level agreement. I will
try to acknowledge a report within a week and keep you informed while I work on it.
Timelines for a fix depend on the severity and on my availability.

I prefer coordinated disclosure: please give me reasonable time to ship a fix before
publishing details. You will be credited in the advisory unless you would rather stay
anonymous. There is no bug bounty.

## Scope

In scope: this repository, meaning the API, the Studio, the CLI, the container image
and their handling of authentication, access control, stored provider credentials,
outbound network policy, and backup and restore.

Out of scope:

- vulnerabilities in third-party services or dependencies themselves (please report
  them upstream, and tell me if our use of them makes them exploitable);
- deployments that go against the documentation, such as exposing an instance
  without TLS or sharing its secrets;
- social engineering, denial of service by sheer volume, and anything that needs
  physical access or an already compromised host.

## Testing

Please test against your own instance and avoid other people's data. The website at
postdot.app is static; its feedback form writes public GitHub discussions, so please
do not test it with automated requests.

## Running an instance

Operators are responsible for their own secrets, updates and backups. The
[self-hosting guide](docs/deployment/self-hosting.md) describes the supported setup
and the backup and restoration boundary.
