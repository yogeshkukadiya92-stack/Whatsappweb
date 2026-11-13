<?php

declare(strict_types=1);

namespace OpenWA\Tests;

use GuzzleHttp\Client as HttpClient;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use OpenWA\Client;
use PHPUnit\Framework\TestCase;

final class DashboardReleaseTest extends TestCase
{
    public function testCsvDownloadsAndEmergencyStop(): void
    {
        $csv = "name,phone\nયોગેશ,123\n";
        $result = ['success' => true, 'sessionId' => 'a/b', 'cancelledJobs' => 3, 'cancelledBatches' => 2, 'cancelledMessages' => 4, 'message' => 'Stopped'];
        $mock = new MockHandler([
            new Response(200, ['Content-Type' => 'text/csv'], $csv),
            new Response(200, ['Content-Type' => 'text/csv'], $csv),
            new Response(200, ['Content-Type' => 'application/json'], json_encode($result)),
        ]);
        $history = [];
        $stack = HandlerStack::create($mock);
        $stack->push(Middleware::history($history));
        $client = new Client(['baseUrl' => 'http://localhost', 'apiKey' => 'key', 'httpClient' => new HttpClient(['handler' => $stack])]);
        self::assertSame($csv, $client->groups->exportParticipantsCsv('a/b', 'g/x'));
        self::assertSame('/api/sessions/a%2Fb/groups/g%2Fx/participants/export/csv', $history[0]['request']->getUri()->getPath());
        self::assertSame('GET', $history[0]['request']->getMethod());
        self::assertSame($csv, $client->groups->exportAllParticipantsCsv('a/b'));
        self::assertSame('/api/sessions/a%2Fb/groups/export/all-participants/csv', $history[1]['request']->getUri()->getPath());
        self::assertSame($result, $client->sessions->stopPendingReplies('a/b'));
        self::assertSame('/api/sessions/a%2Fb/stop-pending-replies', $history[2]['request']->getUri()->getPath());
        self::assertSame('POST', $history[2]['request']->getMethod());
    }
}
