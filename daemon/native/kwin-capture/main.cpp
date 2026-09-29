#include <QGuiApplication>
#include <QScreen>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingReply>
#include <QDBusUnixFileDescriptor>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QImage>
#include <QElapsedTimer>
#include <QThread>
#include <algorithm>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <stdexcept>
#include <unistd.h>
#include <vector>

namespace capture {
constexpr size_t cap = 16 * 1024 * 1024;
constexpr int deadlineMs = 10000;
volatile sig_atomic_t cancelled = 0;
void cancel(int) { cancelled = 1; }
void fail(const char *message) { throw std::runtime_error(message); }
struct Fd {
    int value = -1;
    explicit Fd(int fd = -1) : value(fd) {}
    ~Fd() { if (value >= 0) close(value); }
    Fd(const Fd &) = delete;
    Fd &operator=(const Fd &) = delete;
};
void budget(const QElapsedTimer &clock, int limit = deadlineMs) {
    if (cancelled) fail("cancelled");
    if (clock.elapsed() >= limit) fail("deadline");
}
struct Shape { size_t width, height, stride; int format; size_t bytes; };
Shape shape(quint64 width, quint64 height, quint64 stride, int format) {
    if (format != QImage::Format_RGB32 && format != QImage::Format_ARGB32 &&
        format != QImage::Format_ARGB32_Premultiplied) fail("unsupported format");
    if (!width || !height || width > cap / 4 || height > cap ||
        stride < width * 4 || stride > cap || height > cap / stride)
        fail("image bounds");
    return {size_t(width), size_t(height), size_t(stride), format, size_t(height * stride)};
}
// Conversion is in place: converted bytes never overtake unread source pixels.
size_t rgb(std::vector<unsigned char> &bytes, const Shape &s) {
    if (bytes.size() != s.bytes) fail("payload length");
    size_t out = 0;
    for (size_t y = 0; y < s.height; ++y) {
        for (size_t x = 0; x < s.width; ++x) {
            quint32 pixel;
            std::memcpy(&pixel, bytes.data() + y * s.stride + x * 4, 4);
            if (s.format == QImage::Format_ARGB32_Premultiplied) pixel = qUnpremultiply(pixel);
            bytes[out++] = qRed(pixel);
            bytes[out++] = qGreen(pixel);
            bytes[out++] = qBlue(pixel);
        }
    }
    bytes.resize(out);
    return out;
}
struct Stream {
    std::vector<unsigned char> bytes;
    bool eof = false;
    bool metadata = false;
    size_t expected = cap;
    Stream() { bytes.reserve(cap); }
    void setExpected(size_t n) {
        if (!n || n > cap || bytes.size() > n) fail("payload bounds");
        expected = n;
        metadata = true;
    }
    void drain(int fd) {
        unsigned char chunk[8192];
        // Bound each drain turn so a busy writer cannot starve the deadline.
        for (int turn = 0; turn < 32; ++turn) {
            ssize_t n = read(fd, chunk, sizeof(chunk));
            if (n == 0) { eof = true; return; }
            if (n < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) return;
                if (errno == EINTR) continue;
                fail("pipe read");
            }
            if (size_t(n) > expected - bytes.size()) fail("excess payload");
            bytes.insert(bytes.end(), chunk, chunk + n);
        }
    }
    bool complete() const {
        if (!metadata || !eof) return false;
        if (bytes.size() != expected) fail("truncated payload");
        return true;
    }
};
void writeAll(int fd, const unsigned char *data, size_t size, const QElapsedTimer &clock) {
    while (size) {
        budget(clock);
        ssize_t n = write(fd, data, std::min(size, size_t(8192)));
        if (n > 0) { data += n; size -= size_t(n); continue; }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            pollfd p{fd, POLLOUT, 0};
            if (poll(&p, 1, 5) < 0 && errno != EINTR) fail("output poll");
            continue;
        }
        fail("output write");
    }
}
QDBusMessage await(QDBusPendingCall call, const QElapsedTimer &clock) {
    while (!call.isFinished()) {
        budget(clock);
        QCoreApplication::processEvents();
        QThread::msleep(1);
    }
    budget(clock);
    auto reply = call.reply();
    if (reply.type() == QDBusMessage::ErrorMessage) fail("compositor geometry unavailable");
    return reply;
}
QJsonObject layout(const QElapsedTimer &clock) {
    auto request = QDBusMessage::createMethodCall("org.kde.KWin", "/KWin", "org.kde.KWin", "supportInformation");
    auto reply = await(QDBusConnection::sessionBus().asyncCall(request, deadlineMs), clock);
    if (reply.arguments().size() != 1) fail("geometry reply");
    const QString text = reply.arguments().at(0).toString();
    if (text.size() > 65536) fail("geometry reply bounds");
    QRegularExpression count("Number of Screens: ([0-9]+)\\n");
    auto number = count.match(text);
    if (!number.hasMatch() || number.captured(1) != "1") fail("unsupported output count");
    QRegularExpression screen("Screen 0:\\n-+\\nName: ([^\\n]+)\\nEnabled: 1\\nGeometry: 0,0,([0-9]+)x([0-9]+)\\nPhysical size: [^\\n]+\\nScale: 1\\n");
    auto match = screen.match(text);
    if (!match.hasMatch()) fail("unsupported compositor geometry");
    bool widthOk = false, heightOk = false;
    int width = match.captured(2).toInt(&widthOk), height = match.captured(3).toInt(&heightOk);
    if (!widthOk || !heightOk || width <= 0 || height <= 0) fail("invalid compositor dimensions");
    shape(width, height, quint64(width) * 4, QImage::Format_RGB32);
    auto screens = QGuiApplication::screens();
    if (screens.size() != 1 || screens[0]->geometry() != QRect(0, 0, width, height) ||
        screens[0]->devicePixelRatio() != 1.0) fail("Qt and compositor geometry disagree");
    return {{"name", match.captured(1)}, {"x", 0}, {"y", 0}, {"width", width},
            {"height", height}, {"scale", 1}, {"outputs", 1}};
}
int run(const QElapsedTimer &clock) {
    const auto before = layout(clock);
    int pipeFds[2];
    if (pipe2(pipeFds, O_CLOEXEC | O_NONBLOCK)) fail("pipe creation");
    Fd input(pipeFds[0]);
    // The compositor expects a blocking write end. Only our reader is nonblocking.
    if (fcntl(pipeFds[1], F_SETFL, 0) < 0) { close(pipeFds[1]); fail("pipe flags"); }
    auto request = QDBusMessage::createMethodCall("org.kde.KWin.ScreenShot2", "/org/kde/KWin/ScreenShot2", "org.kde.KWin.ScreenShot2", "CaptureWorkspace");
    QDBusPendingCall call = [&]() {
        Fd output(pipeFds[1]);
        QDBusUnixFileDescriptor descriptor(output.value);
        request << QVariantMap{{"native-resolution", true}} << QVariant::fromValue(descriptor);
        auto pending = QDBusConnection::sessionBus().asyncCall(request, deadlineMs);
        request.setArguments({});
        return pending;
    }();
    Stream stream;
    Shape dimensions{};
    while (!stream.complete()) {
        budget(clock);
        QCoreApplication::processEvents();
        if (!stream.metadata && call.isFinished()) {
            QDBusPendingReply<QVariantMap> reply(call);
            if (reply.isError()) {
                if (reply.error().name() == "org.kde.KWin.ScreenShot2.Error.NoAuthorized") fail("NoAuthorized");
                throw std::runtime_error(("capture DBus failure: " + reply.error().name()).toStdString());
            }
            const auto map = reply.value();
            auto integer = [&](const char *key) -> quint64 {
                auto it = map.constFind(key);
                if (it == map.cend() || it->metaType().id() != QMetaType::UInt) fail("invalid image metadata");
                return it->toUInt();
            };
            if (!map.contains("scale") || map["scale"].metaType().id() != QMetaType::Double || map["scale"].toDouble() != 1.0)
                fail("unsupported capture scale");
            dimensions = shape(integer("width"), integer("height"), integer("stride"), int(integer("format")));
            if (dimensions.width != size_t(before["width"].toInt()) || dimensions.height != size_t(before["height"].toInt()))
                fail("capture and compositor dimensions disagree");
            stream.setExpected(dimensions.bytes);
        }
        if (!stream.eof) stream.drain(input.value);
        if (!stream.complete()) QThread::msleep(1);
    }
    const auto after = layout(clock);
    if (before != after) fail("layout changed");
    rgb(stream.bytes, dimensions);
    QJsonObject header{{"version", 1}, {"format", "RGB"}, {"width", int(dimensions.width)},
        {"height", int(dimensions.height)}, {"stride", int(dimensions.width * 3)},
        {"x", 0}, {"y", 0}, {"scale", 1}, {"layout", before}, {"bytes", int(stream.bytes.size())}};
    const auto json = QJsonDocument(header).toJson(QJsonDocument::Compact);
    if (json.size() > 4096) fail("frame header bounds");
    const quint32 n = quint32(json.size());
    const unsigned char prefix[4] = {static_cast<unsigned char>(n >> 24), static_cast<unsigned char>(n >> 16), static_cast<unsigned char>(n >> 8), static_cast<unsigned char>(n)};
    if (fcntl(STDOUT_FILENO, F_SETFL, fcntl(STDOUT_FILENO, F_GETFL) | O_NONBLOCK) < 0) fail("stdout flags");
    writeAll(STDOUT_FILENO, prefix, 4, clock);
    writeAll(STDOUT_FILENO, reinterpret_cast<const unsigned char *>(json.constData()), size_t(json.size()), clock);
    writeAll(STDOUT_FILENO, stream.bytes.data(), stream.bytes.size(), clock);
    return 0;
}
}
#ifndef CAPTURE_TEST
int main(int argc, char **argv) {
    // SIGALRM also bounds toolkit initialization and any unexpected synchronous call.
    alarm(10);
    signal(SIGTERM, capture::cancel);
    signal(SIGINT, capture::cancel);
    signal(SIGPIPE, SIG_IGN);
    QElapsedTimer clock;
    clock.start();
    if (argc != 1 || getuid() == 0) { std::fputs("desktop-user invocation required\n", stderr); return 2; }
    QGuiApplication app(argc, argv);
    try { return capture::run(clock); }
    catch (const std::exception &error) { std::fprintf(stderr, "capture: %s\n", error.what()); return 1; }
}
#endif
