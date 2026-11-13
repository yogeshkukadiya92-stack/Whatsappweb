import httpx
from openwa import OpenWAClient


def test_csv_exports_keep_utf8_and_encode_ids():
    calls = []
    csv = 'name,phone\nયોગેશ,123\n'
    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=csv.encode('utf-8'), headers={'content-type': 'text/csv'})
    client = OpenWAClient(base_url='http://localhost', api_key='key', transport=httpx.MockTransport(handler))
    assert client.groups.export_participants_csv('a/b', 'g/x') == csv
    assert str(calls[-1].url) == 'http://localhost/api/sessions/a%2Fb/groups/g%2Fx/participants/export/csv'
    assert calls[-1].method == 'GET'
    assert client.groups.export_all_participants_csv('a/b') == csv
    assert str(calls[-1].url) == 'http://localhost/api/sessions/a%2Fb/groups/export/all-participants/csv'


def test_emergency_stop_keeps_counts():
    calls = []
    result = dict(success=True, sessionId='a/b', cancelledJobs=3, cancelledBatches=2, cancelledMessages=4, message='Stopped')
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=result)
    client = OpenWAClient(base_url='http://localhost', api_key='key', transport=httpx.MockTransport(handler))
    assert client.sessions.stop_pending_replies('a/b') == result
    assert str(calls[-1].url) == 'http://localhost/api/sessions/a%2Fb/stop-pending-replies'
    assert calls[-1].method == 'POST'
