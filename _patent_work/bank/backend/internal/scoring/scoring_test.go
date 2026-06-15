package scoring

import (
	"testing"

	"github.com/example/monorepo/backend/internal/excelio"
)

func mkMed(id string, name string, phone string, amt float64, hasNumeric bool) excelio.MedicalRow {
	r := excelio.MedicalRow{
		PsnNo:      "",
		PsnName:    name,
		Phone:      phone,
		IDCard:     id,
		PsnClctAmt: amt,
	}
	if !hasNumeric {
		// represent non-numeric by NaN
		r.PsnClctAmt = 0
		// but signal non-numeric via NaN in other tests; here we'll set HasNumeric in aggregation by providing amt and a separate flag.
	}
	return r
}

func mkMedNumeric(id string, name string, phone string, amt float64) excelio.MedicalRow {
	r := excelio.MedicalRow{
		PsnName:    name,
		Phone:      phone,
		IDCard:     id,
		PsnClctAmt: amt,
	}
	return r
}

func TestBuildContextAggregation(t *testing.T) {
	meds := []excelio.MedicalRow{
		mkMedNumeric("ID1", "Alice", "138", 2000),
		mkMedNumeric("ID1", "", "", 3500),
		mkMedNumeric("ID2", "Bob", "139", 10000),
	}
	ctx := BuildContext(meds)
	if len(ctx.MedicalAgg) != 2 {
		t.Fatalf("expected 2 aggs got %d", len(ctx.MedicalAgg))
	}
	a := ctx.MedicalAgg["ID1"]
	if a.PsnName != "Alice" {
		t.Fatalf("expected name Alice got %q", a.PsnName)
	}
	if a.SumClctAmt != 5500 {
		t.Fatalf("expected sum 5500 got %v", a.SumClctAmt)
	}
	if !a.HasNumericAmt {
		t.Fatalf("expected HasNumericAmt true")
	}
}

func TestMedicalBaseRuleThresholds(t *testing.T) {
	makeAndScore := func(sum float64) int {
		meds := []excelio.MedicalRow{
			mkMedNumeric("IDX", "X", "", sum),
		}
		ctx := BuildContext(meds)
		br := excelio.BankRow{BankUserID: "B", Name: "X", IDCard: "IDX"}
		r := MedicalBaseRule{}
		s, _ := r.Score(ctx, br)
		return s
	}
	cases := []struct {
		sum float64
		exp int
	}{
		{4999, 0},
		{5000, 0},
		{5001, 3},
		{10000, 3},
		{10001, 5},
		{20000, 5},
		{20001, 7},
	}
	for _, c := range cases {
		got := makeAndScore(c.sum)
		if got != c.exp {
			t.Fatalf("sum %v expected %d got %d", c.sum, c.exp, got)
		}
	}
}

func TestPhoneMatchRule(t *testing.T) {
	meds := []excelio.MedicalRow{
		mkMedNumeric("IDP", "P", "1000", 1000),
	}
	ctx := BuildContext(meds)
	r := PhoneMatchRule{}
	br := excelio.BankRow{BankUserID: "B", Name: "P", Phone: "1000", IDCard: "IDP"}
	s, _ := r.Score(ctx, br)
	if s != 1 {
		t.Fatalf("expected phone match 1 got %d", s)
	}
	// mismatch
	br2 := excelio.BankRow{BankUserID: "B2", Name: "P", Phone: "2000", IDCard: "IDP"}
	s2, _ := r.Score(ctx, br2)
	if s2 != 0 {
		t.Fatalf("expected phone match 0 got %d", s2)
	}
	// missing phone
	br3 := excelio.BankRow{BankUserID: "B3", Name: "P", Phone: "", IDCard: "IDP"}
	s3, _ := r.Score(ctx, br3)
	if s3 != 0 {
		t.Fatalf("expected phone match 0 for missing got %d", s3)
	}
}

func TestScoreAllCombinesRulesAndUsesMedicalName(t *testing.T) {
	meds := []excelio.MedicalRow{
		mkMedNumeric("IDALL", "MedName", "555", 6000),
	}
	ctx := BuildContext(meds)
	banks := []excelio.BankRow{
		{BankUserID: "B1", Name: "BankName", Phone: "555", IDCard: "IDALL"},
		{BankUserID: "B2", Name: "BankName2", Phone: "999", IDCard: "IDALL"},
	}
	rules := []Rule{PhoneMatchRule{}, MedicalBaseRule{}}
	out, err := ScoreAll(ctx, banks, rules)
	if err != nil {
		t.Fatalf("ScoreAll failed: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected 2 results got %d", len(out))
	}
	// first: phone match (1) + base (3) = 4, name from medical
	if out[0].Result != 4 || out[0].PsnName != "MedName" {
		t.Fatalf("unexpected first result %+v", out[0])
	}
	// second: phone mismatch -> 0 + base 3 = 3
	if out[1].Result != 3 || out[1].PsnName != "MedName" {
		t.Fatalf("unexpected second result %+v", out[1])
	}
}


