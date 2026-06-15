package scoring

import (
	"strings"

	"github.com/example/monorepo/backend/internal/excelio"
)

type Rule interface {
	Name() string
	Score(ctx *Context, bank excelio.BankRow) (int, error)
}

type MedicalAgg struct {
	PsnName       string
	Phone         string
	SumClctAmt    float64
	HasNumericAmt bool
}

type Context struct {
	MedicalByID map[string][]excelio.MedicalRow
	MedicalAgg  map[string]MedicalAgg
}

// BuildContext aggregates medical rows by id_card
func BuildContext(medicals []excelio.MedicalRow) *Context {
	ctx := &Context{
		MedicalByID: make(map[string][]excelio.MedicalRow),
		MedicalAgg:  make(map[string]MedicalAgg),
	}
	for _, m := range medicals {
		id := strings.TrimSpace(m.IDCard)
		ctx.MedicalByID[id] = append(ctx.MedicalByID[id], m)
	}
	for id, rows := range ctx.MedicalByID {
		var agg MedicalAgg
		agg.SumClctAmt = 0
		for _, r := range rows {
			// first non-empty name
			if agg.PsnName == "" && strings.TrimSpace(r.PsnName) != "" {
				agg.PsnName = strings.TrimSpace(r.PsnName)
			}
			// first non-empty phone
			if agg.Phone == "" && strings.TrimSpace(r.Phone) != "" {
				agg.Phone = strings.TrimSpace(r.Phone)
			}
			if !isNaN(r.PsnClctAmt) {
				agg.SumClctAmt += r.PsnClctAmt
				agg.HasNumericAmt = true
			}
		}
		ctx.MedicalAgg[id] = agg
		// ensure key exists even for empty id
		_ = id
	}
	return ctx
}

func isNaN(f float64) bool {
	return f != f
}

// PhoneMatchRule: bank.Phone == medicalAgg.Phone -> 1 else 0
type PhoneMatchRule struct{}

func (PhoneMatchRule) Name() string { return "PhoneMatchRule" }

func (PhoneMatchRule) Score(ctx *Context, bank excelio.BankRow) (int, error) {
	bp := strings.TrimSpace(bank.Phone)
	if bp == "" {
		return 0, nil
	}
	agg, ok := ctx.MedicalAgg[strings.TrimSpace(bank.IDCard)]
	if !ok {
		return 0, nil
	}
	mp := strings.TrimSpace(agg.Phone)
	if mp == "" {
		return 0, nil
	}
	if bp == mp {
		return 1, nil
	}
	return 0, nil
}

// MedicalBaseRule: aggregate sum thresholds
type MedicalBaseRule struct{}

func (MedicalBaseRule) Name() string { return "MedicalBaseRule" }

func (MedicalBaseRule) Score(ctx *Context, bank excelio.BankRow) (int, error) {
	agg, ok := ctx.MedicalAgg[strings.TrimSpace(bank.IDCard)]
	if !ok {
		return 0, nil
	}
	if !agg.HasNumericAmt {
		return 0, nil
	}
	sum := agg.SumClctAmt
	// thresholds per spec:
	// sum < 5000 -> 0
	// 5000 < sum <= 10000 -> 3
	// 10000 < sum <= 20000 -> 5
	// sum > 20000 -> 7
	if sum < 5000 {
		return 0, nil
	}
	if sum > 5000 && sum <= 10000 {
		return 3, nil
	}
	if sum > 10000 && sum <= 20000 {
		return 5, nil
	}
	if sum > 20000 {
		return 7, nil
	}
	return 0, nil
}

// ScoreAll applies rules to all bank rows and returns results
func ScoreAll(ctx *Context, bankRows []excelio.BankRow, rules []Rule) ([]excelio.ResultRow, error) {
	out := make([]excelio.ResultRow, 0, len(bankRows))
	for _, b := range bankRows {
		total := 0
		for _, r := range rules {
			s, err := r.Score(ctx, b)
			if err != nil {
				return nil, err
			}
			total += s
		}
		psnName := strings.TrimSpace(b.Name)
		if agg, ok := ctx.MedicalAgg[strings.TrimSpace(b.IDCard)]; ok {
			if strings.TrimSpace(agg.PsnName) != "" {
				psnName = agg.PsnName
			}
		}
		out = append(out, excelio.ResultRow{
			BankUserID: b.BankUserID,
			PsnName:    psnName,
			Result:     total,
		})
	}
	return out, nil
}


