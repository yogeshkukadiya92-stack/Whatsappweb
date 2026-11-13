package openwa

import (
	"context"
	"testing"
)

func TestDashboardReleaseCSV(t *testing.T) {
	csv := "name,phone\nયોગેશ,123\n"
	rt := &recordTransport{status: 200, body: csv}
	client := newTestClient(t, rt)
	result, err := client.Groups.ExportParticipantsCsv(context.Background(), "a/b", "g/x")
	if err != nil || result != csv {
		t.Fatalf("CSV = %q, error = %v", result, err)
	}
	if got := rt.lastReq.URL.EscapedPath(); got != "/api/sessions/a%2Fb/groups/g%2Fx/participants/export/csv" {
		t.Fatal(got)
	}
	result, err = client.Groups.ExportAllParticipantsCsv(context.Background(), "a/b")
	if err != nil || result != csv {
		t.Fatalf("CSV = %q, error = %v", result, err)
	}
	if got := rt.lastReq.URL.EscapedPath(); got != "/api/sessions/a%2Fb/groups/export/all-participants/csv" {
		t.Fatal(got)
	}
}

func TestDashboardReleaseEmergencyStop(t *testing.T) {
	rt := &recordTransport{status: 200, body: `{"success":true,"sessionId":"a/b","cancelledJobs":3,"cancelledBatches":2,"cancelledMessages":4,"message":"Stopped"}`}
	client := newTestClient(t, rt)
	result, err := client.Sessions.StopPendingReplies(context.Background(), "a/b")
	if err != nil || !result.Success || result.CancelledJobs != 3 || result.CancelledBatches != 2 || result.CancelledMessages != 4 {
		t.Fatalf("result = %+v, error = %v", result, err)
	}
	if rt.lastReq.Method != "POST" || rt.lastReq.URL.EscapedPath() != "/api/sessions/a%2Fb/stop-pending-replies" {
		t.Fatal(rt.lastReq)
	}
}
