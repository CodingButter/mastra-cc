# Can Node read the accessibility tree?

Produced by `spikes/daemon/node-atspi.mjs`, which is deleted at the end of M0.5.

This is the question the daemon's language rests on. If Node can reach the Linux
accessibility layer, the daemon is one process in one language. If it cannot, it
is Node plus a Python sidecar, and a seam between them for the life of the
project.

The approach matters: **AT-SPI is D-Bus underneath.** `libatspi` is a
convenience wrapper over a published bus protocol, not a private channel. So
this does not bind to a C library or compile anything — it speaks the protocol
directly with a plain D-Bus client, which is why no native module and no
GObject introspection appears anywhere in it.

## Result

| | Node, over plain D-Bus | Python `Atspi` bindings |
|---|---|---|
| Applications on the accessibility desktop | 18 | 18 |
| Nodes reached in a bounded walk | 400 | 400 |

Of the 400 nodes Node reached: **400 returned a role**,
**39 returned a name**, and **400 returned a state set**.

First fully-read element: `application "gnome-shell"`

Both figures are capped at 400 nodes by the walk itself, so a matching pair at
the ceiling means both routes were still going, not that the desktop ran out.
The application count is the uncapped comparison and is the one to read.

## What this settles

Node reaches the accessibility layer with **no native compilation, no GObject
introspection, and no Python in the process**. It enumerates applications, walks
the tree, and reads the three things a daemon actually needs — role, name, and
states. Reading a child count would not have been evidence of a legible tree;
reading roles and names is.

The consequence for ADR-0010 is direct. That record chose Python for the Linux
backend because the bindings were assumed to require it. The assumption does not
survive: the bindings are a convenience, and the daemon can speak the protocol
they wrap.

## What this does not settle

**Reading is not writing.** This walks and reads. Invoking actions, setting text
and typing all go through other interfaces, and none of them is exercised here.

**Nor does it settle the event stream.** A daemon that cannot subscribe to
accessibility signals is not a daemon, and this spike does not subscribe to
anything. Both are cheap to test and neither has been.

## Receipt

```
node spikes/daemon/node-atspi.mjs
```
