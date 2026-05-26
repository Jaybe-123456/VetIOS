-- VetIOS veterinary knowledge graph seed v1.
-- Scope: canine/feline only, 50 disease nodes, 200 symptom nodes, 500 weighted edges.

insert into public.vet_disease_nodes (label, display_name, species, base_prior, urgency, graph_version)
values
    ('canine_parvovirus', 'Canine Parvovirus', 'canine', 0.030, 'high', 1),
    ('hemorrhagic_gastroenteritis', 'Hemorrhagic Gastroenteritis', 'canine', 0.025, 'high', 1),
    ('pancreatitis', 'Pancreatitis', 'canine', 0.040, 'medium', 1),
    ('leptospirosis', 'Leptospirosis', 'canine', 0.018, 'high', 1),
    ('ehrlichiosis', 'Ehrlichiosis', 'canine', 0.018, 'medium', 1),
    ('babesiosis', 'Babesiosis', 'canine', 0.012, 'high', 1),
    ('distemper', 'Canine Distemper', 'canine', 0.010, 'high', 1),
    ('kennel_cough', 'Kennel Cough', 'canine', 0.050, 'low', 1),
    ('hypothyroidism', 'Hypothyroidism', 'canine', 0.035, 'low', 1),
    ('diabetes_mellitus', 'Diabetes Mellitus', 'canine', 0.025, 'medium', 1),
    ('addisons_disease', 'Addison''s Disease', 'canine', 0.012, 'high', 1),
    ('cushings_syndrome', 'Cushing''s Syndrome', 'canine', 0.020, 'medium', 1),
    ('dlbcl_lymphoma', 'Diffuse Large B-Cell Lymphoma', 'canine', 0.010, 'high', 1),
    ('osteosarcoma', 'Osteosarcoma', 'canine', 0.012, 'high', 1),
    ('hip_dysplasia', 'Hip Dysplasia', 'canine', 0.035, 'medium', 1),
    ('intervertebral_disc_disease', 'Intervertebral Disc Disease', 'canine', 0.030, 'high', 1),
    ('degenerative_myelopathy', 'Degenerative Myelopathy', 'canine', 0.010, 'medium', 1),
    ('dilated_cardiomyopathy', 'Dilated Cardiomyopathy', 'canine', 0.014, 'high', 1),
    ('mitral_valve_disease', 'Mitral Valve Disease', 'canine', 0.040, 'medium', 1),
    ('urinary_tract_infection', 'Urinary Tract Infection', 'canine', 0.045, 'medium', 1),
    ('chronic_kidney_disease', 'Chronic Kidney Disease', 'canine', 0.030, 'medium', 1),
    ('liver_disease', 'Liver Disease', 'canine', 0.025, 'medium', 1),
    ('anemia', 'Anemia', 'canine', 0.030, 'medium', 1),
    ('tick_fever', 'Tick Fever', 'canine', 0.018, 'medium', 1),
    ('gastric_dilatation_volvulus', 'Gastric Dilatation Volvulus', 'canine', 0.008, 'high', 1),
    ('feline_panleukopenia', 'Feline Panleukopenia', 'feline', 0.020, 'high', 1),
    ('feline_herpesvirus', 'Feline Herpesvirus', 'feline', 0.045, 'medium', 1),
    ('feline_calicivirus', 'Feline Calicivirus', 'feline', 0.040, 'medium', 1),
    ('feline_leukemia_virus', 'Feline Leukemia Virus', 'feline', 0.018, 'high', 1),
    ('feline_immunodeficiency_virus', 'Feline Immunodeficiency Virus', 'feline', 0.018, 'medium', 1),
    ('feline_infectious_peritonitis', 'Feline Infectious Peritonitis', 'feline', 0.010, 'high', 1),
    ('hyperthyroidism', 'Hyperthyroidism', 'feline', 0.045, 'medium', 1),
    ('diabetes_mellitus_feline', 'Feline Diabetes Mellitus', 'feline', 0.025, 'medium', 1),
    ('chronic_kidney_disease_feline', 'Feline Chronic Kidney Disease', 'feline', 0.055, 'medium', 1),
    ('lower_urinary_tract_disease', 'Feline Lower Urinary Tract Disease', 'feline', 0.050, 'medium', 1),
    ('hypertrophic_cardiomyopathy', 'Hypertrophic Cardiomyopathy', 'feline', 0.020, 'high', 1),
    ('hepatic_lipidosis', 'Hepatic Lipidosis', 'feline', 0.020, 'high', 1),
    ('inflammatory_bowel_disease', 'Inflammatory Bowel Disease', 'feline', 0.030, 'medium', 1),
    ('lymphoma_feline', 'Feline Lymphoma', 'feline', 0.018, 'high', 1),
    ('toxoplasmosis', 'Toxoplasmosis', 'feline', 0.012, 'medium', 1),
    ('ringworm_dermatophytosis', 'Ringworm Dermatophytosis', 'feline', 0.035, 'low', 1),
    ('asthma_feline', 'Feline Asthma', 'feline', 0.030, 'medium', 1),
    ('upper_respiratory_infection', 'Upper Respiratory Infection', 'feline', 0.060, 'low', 1),
    ('dental_disease', 'Dental Disease', 'feline', 0.060, 'medium', 1),
    ('obesity_feline', 'Feline Obesity', 'feline', 0.070, 'low', 1),
    ('urinary_obstruction', 'Urinary Obstruction', 'feline', 0.020, 'high', 1),
    ('constipation_megacolon', 'Constipation/Megacolon', 'feline', 0.025, 'medium', 1),
    ('anemia_feline', 'Feline Anemia', 'feline', 0.025, 'medium', 1),
    ('hypocalcemia', 'Hypocalcemia', 'feline', 0.006, 'high', 1),
    ('pleural_effusion', 'Pleural Effusion', 'feline', 0.014, 'high', 1)
on conflict (label) do nothing;

with symptoms(label, species, prevalence_weight) as (
    values
    ('lethargy','both',1.00), ('anorexia','both',1.00), ('weight_loss','both',0.90), ('weight_gain','both',0.70), ('fever','both',0.95),
    ('hypothermia','both',0.60), ('dehydration','both',0.90), ('pale_mucous_membranes','both',0.85), ('icteric_mucous_membranes','both',0.65), ('lymphadenopathy','both',0.70),
    ('vomiting','both',1.00), ('diarrhea','both',0.95), ('bloody_diarrhea','both',0.85), ('constipation','both',0.75), ('abdominal_pain','both',0.85),
    ('bloating','both',0.65), ('melena','both',0.65), ('regurgitation','both',0.55), ('dysphagia','both',0.45), ('excessive_drooling','both',0.60), ('anorexia_gi','both',0.70),
    ('coughing','both',0.90), ('sneezing','both',0.85), ('dyspnea','both',0.85), ('tachypnea','both',0.75), ('nasal_discharge_clear','both',0.75),
    ('nasal_discharge_purulent','both',0.70), ('open_mouth_breathing_feline','feline',0.60), ('wheezing','both',0.65), ('hemoptysis','both',0.35),
    ('polyuria','both',0.85), ('polydipsia','both',0.85), ('dysuria','both',0.80), ('hematuria','both',0.80), ('urethral_obstruction','both',0.65),
    ('incontinence','both',0.55), ('anuria','both',0.45), ('oliguria','both',0.45),
    ('seizures','both',0.60), ('ataxia','both',0.65), ('paresis','both',0.55), ('paralysis','both',0.50), ('head_tilt','both',0.45),
    ('nystagmus','both',0.45), ('altered_mentation','both',0.65), ('tremors','both',0.55), ('circling','both',0.40),
    ('pruritus','both',0.75), ('alopecia','both',0.70), ('erythema','both',0.65), ('skin_lesions','both',0.65), ('nodules','both',0.45),
    ('scaling','both',0.55), ('crusting','both',0.55), ('otitis','both',0.65), ('hyperpigmentation','both',0.45), ('pododermatitis','both',0.45),
    ('tachycardia','both',0.75), ('bradycardia','both',0.45), ('heart_murmur','both',0.70), ('exercise_intolerance','both',0.65), ('syncope','both',0.55),
    ('weak_pulse','both',0.55), ('pulse_deficit','both',0.45), ('jugular_distension','both',0.45), ('ascites','both',0.55), ('cyanosis','both',0.45),
    ('cough_cardiac','both',0.50), ('arrhythmia','both',0.55), ('gallop_rhythm','both',0.45), ('pulmonary_edema','both',0.55), ('hindlimb_weakness_cardiac','both',0.40),
    ('ocular_discharge','both',0.70), ('conjunctivitis','both',0.65), ('uveitis','both',0.45), ('anisocoria','both',0.35), ('blindness','both',0.45),
    ('corneal_ulcer','both',0.45), ('blepharospasm','both',0.45), ('third_eyelid_elevation','both',0.40), ('retinal_hemorrhage','both',0.35), ('photophobia','both',0.35),
    ('lameness','both',0.80), ('stiffness','both',0.65), ('joint_swelling','both',0.55), ('muscle_wasting','both',0.55), ('reluctance_to_jump','both',0.60),
    ('back_pain','both',0.65), ('neck_pain','both',0.55), ('fractures','both',0.45), ('crepitus','both',0.40), ('decreased_range_of_motion','both',0.55),
    ('limb_pain','both',0.65), ('shifting_leg_lameness','both',0.45), ('knuckling','both',0.50), ('pelvic_limb_ataxia','both',0.50), ('exercise_induced_collapse','both',0.45),
    ('polyphagia','both',0.65), ('heat_intolerance','both',0.45), ('cold_intolerance','both',0.45), ('panting','canine',0.55), ('pot_bellied_appearance','canine',0.45),
    ('haircoat_poor','both',0.55), ('symmetrical_alopecia','both',0.50), ('thin_skin','canine',0.40), ('muscle_weakness','both',0.55), ('cataracts','both',0.45),
    ('hypoglycemia','both',0.45), ('hyperglycemia','both',0.50),
    ('petechiae','both',0.50), ('ecchymoses','both',0.45), ('epistaxis','both',0.45), ('bleeding_gums','both',0.45), ('thrombocytopenia','both',0.50),
    ('leukopenia','both',0.50), ('leukocytosis','both',0.50), ('anemia_lab','both',0.55), ('regenerative_anemia','both',0.45), ('nonregenerative_anemia','both',0.45),
    ('splenomegaly','both',0.45), ('coagulopathy','both',0.45),
    ('azotemia','both',0.60), ('elevated_bun','both',0.55), ('elevated_creatinine','both',0.55), ('proteinuria','both',0.50), ('isosthenuria','both',0.50),
    ('dilute_urine','both',0.45), ('small_kidneys','both',0.45), ('enlarged_kidneys','both',0.40), ('uremic_breath','both',0.45), ('oral_ulcers','both',0.45),
    ('hypertension','both',0.55), ('electrolyte_abnormality','both',0.55),
    ('elevated_alt','both',0.55), ('elevated_alp','both',0.55), ('hyperbilirubinemia','both',0.55), ('hypoalbuminemia','both',0.45), ('ascites_hepatic','both',0.45),
    ('hepatic_encephalopathy','both',0.45), ('head_pressing','both',0.40), ('ptyalism','both',0.45), ('photosensitivity','both',0.30), ('clotting_delay','both',0.40),
    ('microhepatica','both',0.30), ('hepatomegaly','both',0.45),
    ('pyometra_discharge','both',0.35), ('vaginal_discharge','both',0.45), ('dystocia','both',0.35), ('testicular_swelling','both',0.35), ('prostatomegaly','canine',0.35),
    ('mammary_mass','both',0.35), ('false_pregnancy','canine',0.30), ('infertility','both',0.30), ('scrotal_pain','both',0.35), ('estrus_abnormality','both',0.35),
    ('inappropriate_urination','feline',0.70), ('periuria','feline',0.65), ('stranguria','feline',0.70), ('vocalizing_in_litterbox','feline',0.60), ('hiding','feline',0.60),
    ('grooming_decrease','feline',0.55), ('hairballs','feline',0.40), ('chronic_vomiting','feline',0.60), ('acute_blindness_feline','feline',0.35), ('plantigrade_stance','feline',0.35),
    ('oral_pain','feline',0.60), ('resorptive_lesions','feline',0.45), ('pleural_effusion_feline','feline',0.50), ('chylothorax','feline',0.30), ('eosinophilic_plaques','feline',0.35),
    ('unproductive_retching','canine',0.60), ('acute_abdominal_distension','canine',0.55), ('vaccine_lapsed','canine',0.50), ('tick_exposure','canine',0.55), ('travel_history','canine',0.40),
    ('kennel_exposure','canine',0.55), ('weight_bearing_lameness','canine',0.50), ('large_breed','canine',0.55), ('deep_chested_breed','canine',0.45), ('toy_breed','canine',0.45),
    ('pruritic_otitis','canine',0.45), ('acute_collapse','canine',0.55), ('exercise_cough','canine',0.45), ('hindlimb_paralysis','canine',0.45), ('anal_scooting','canine',0.35),
    ('recent_shelter_exposure','both',0.55), ('unvaccinated','both',0.65), ('flea_exposure','both',0.45), ('tick_attachment','both',0.50), ('bite_wound','both',0.45),
    ('abscess','both',0.45), ('pyrexia_of_unknown_origin','both',0.50), ('purulent_discharge','both',0.45), ('sepsis_signs','both',0.45), ('shock','both',0.55),
    ('wbc_low','both',0.50), ('pcv_low','both',0.50), ('platelets_low','both',0.50), ('glucose_high','both',0.50), ('ketonuria','both',0.45)
)
insert into public.vet_symptom_nodes (label, display_name, species, prevalence_weight, graph_version)
select label, initcap(replace(label, '_', ' ')), species, prevalence_weight, 1
from symptoms
on conflict (label) do nothing;

with disease_symptom_seed(label, symptoms) as (
    values
    ('canine_parvovirus', array['vomiting','bloody_diarrhea','lethargy','anorexia','dehydration','fever','unvaccinated','wbc_low','pcv_low','shock']),
    ('hemorrhagic_gastroenteritis', array['bloody_diarrhea','vomiting','dehydration','lethargy','anorexia_gi','abdominal_pain','shock','weak_pulse','tachycardia','pale_mucous_membranes']),
    ('pancreatitis', array['vomiting','abdominal_pain','anorexia','lethargy','dehydration','diarrhea','fever','hyperglycemia','icteric_mucous_membranes','shock']),
    ('leptospirosis', array['fever','lethargy','anorexia','vomiting','icteric_mucous_membranes','polyuria','polydipsia','azotemia','elevated_bun','thrombocytopenia']),
    ('ehrlichiosis', array['fever','lethargy','anorexia','lymphadenopathy','pale_mucous_membranes','petechiae','epistaxis','thrombocytopenia','tick_exposure','tick_attachment']),
    ('babesiosis', array['fever','lethargy','pale_mucous_membranes','icteric_mucous_membranes','anemia_lab','tachycardia','splenomegaly','tick_exposure','muscle_weakness','acute_collapse']),
    ('distemper', array['fever','nasal_discharge_purulent','coughing','dyspnea','seizures','tremors','altered_mentation','unvaccinated','ocular_discharge','diarrhea']),
    ('kennel_cough', array['coughing','kennel_exposure','fever','nasal_discharge_clear','nasal_discharge_purulent','sneezing','exercise_cough','lethargy','anorexia','tachypnea']),
    ('hypothyroidism', array['weight_gain','lethargy','cold_intolerance','symmetrical_alopecia','haircoat_poor','bradycardia','exercise_intolerance','skin_lesions','hyperpigmentation','otitis']),
    ('diabetes_mellitus', array['polyuria','polydipsia','polyphagia','weight_loss','hyperglycemia','glucose_high','ketonuria','cataracts','lethargy','dehydration']),
    ('addisons_disease', array['lethargy','vomiting','diarrhea','anorexia','acute_collapse','weak_pulse','bradycardia','dehydration','hypoglycemia','electrolyte_abnormality']),
    ('cushings_syndrome', array['polyuria','polydipsia','polyphagia','panting','pot_bellied_appearance','thin_skin','symmetrical_alopecia','muscle_weakness','hyperglycemia','skin_lesions']),
    ('dlbcl_lymphoma', array['lymphadenopathy','weight_loss','lethargy','anorexia','fever','splenomegaly','pale_mucous_membranes','dyspnea','vomiting','diarrhea']),
    ('osteosarcoma', array['lameness','limb_pain','large_breed','weight_bearing_lameness','fractures','muscle_wasting','lethargy','anorexia','joint_swelling','exercise_intolerance']),
    ('hip_dysplasia', array['lameness','stiffness','reluctance_to_jump','large_breed','decreased_range_of_motion','muscle_wasting','pelvic_limb_ataxia','exercise_intolerance','limb_pain','crepitus']),
    ('intervertebral_disc_disease', array['back_pain','neck_pain','paresis','paralysis','ataxia','knuckling','hindlimb_paralysis','limb_pain','incontinence','tremors']),
    ('degenerative_myelopathy', array['pelvic_limb_ataxia','paresis','knuckling','hindlimb_weakness_cardiac','paralysis','muscle_wasting','large_breed','incontinence','exercise_intolerance','stiffness']),
    ('dilated_cardiomyopathy', array['exercise_intolerance','dyspnea','coughing','tachypnea','syncope','arrhythmia','weak_pulse','ascites','pulmonary_edema','large_breed']),
    ('mitral_valve_disease', array['heart_murmur','coughing','exercise_intolerance','tachypnea','dyspnea','pulmonary_edema','syncope','arrhythmia','weak_pulse','cyanosis']),
    ('urinary_tract_infection', array['dysuria','hematuria','incontinence','polyuria','polydipsia','fever','lethargy','abdominal_pain','urethral_obstruction','anorexia']),
    ('chronic_kidney_disease', array['polyuria','polydipsia','weight_loss','anorexia','vomiting','dehydration','azotemia','uremic_breath','oral_ulcers','hypertension']),
    ('liver_disease', array['icteric_mucous_membranes','vomiting','anorexia','weight_loss','lethargy','ascites_hepatic','hepatic_encephalopathy','head_pressing','elevated_alt','elevated_alp']),
    ('anemia', array['pale_mucous_membranes','lethargy','tachycardia','weak_pulse','exercise_intolerance','pcv_low','regenerative_anemia','nonregenerative_anemia','melena','acute_collapse']),
    ('tick_fever', array['fever','tick_exposure','tick_attachment','lethargy','anorexia','lymphadenopathy','petechiae','thrombocytopenia','pale_mucous_membranes','joint_swelling']),
    ('gastric_dilatation_volvulus', array['acute_abdominal_distension','unproductive_retching','bloating','abdominal_pain','shock','weak_pulse','pale_mucous_membranes','tachycardia','deep_chested_breed','acute_collapse']),
    ('feline_panleukopenia', array['vomiting','diarrhea','bloody_diarrhea','lethargy','anorexia','dehydration','fever','unvaccinated','wbc_low','shock']),
    ('feline_herpesvirus', array['sneezing','nasal_discharge_clear','nasal_discharge_purulent','ocular_discharge','conjunctivitis','corneal_ulcer','fever','anorexia','lethargy','oral_pain']),
    ('feline_calicivirus', array['sneezing','nasal_discharge_clear','oral_ulcers','excessive_drooling','fever','lameness','anorexia','lethargy','ocular_discharge','dyspnea']),
    ('feline_leukemia_virus', array['weight_loss','lethargy','anorexia','pale_mucous_membranes','fever','lymphadenopathy','oral_pain','diarrhea','dyspnea','anemia_lab']),
    ('feline_immunodeficiency_virus', array['weight_loss','fever','lymphadenopathy','oral_pain','resorptive_lesions','skin_lesions','anorexia','lethargy','diarrhea','abscess']),
    ('feline_infectious_peritonitis', array['fever','weight_loss','anorexia','lethargy','ascites','dyspnea','pleural_effusion_feline','uveitis','icteric_mucous_membranes','altered_mentation']),
    ('hyperthyroidism', array['weight_loss','polyphagia','vomiting','diarrhea','tachycardia','heart_murmur','hypertension','heat_intolerance','haircoat_poor','polyuria']),
    ('diabetes_mellitus_feline', array['polyuria','polydipsia','polyphagia','weight_loss','hyperglycemia','glucose_high','ketonuria','plantigrade_stance','lethargy','dehydration']),
    ('chronic_kidney_disease_feline', array['polyuria','polydipsia','weight_loss','anorexia','vomiting','dehydration','azotemia','uremic_breath','oral_ulcers','hypertension']),
    ('lower_urinary_tract_disease', array['inappropriate_urination','periuria','stranguria','dysuria','hematuria','vocalizing_in_litterbox','urethral_obstruction','anuria','lethargy','anorexia']),
    ('hypertrophic_cardiomyopathy', array['heart_murmur','dyspnea','tachypnea','open_mouth_breathing_feline','pleural_effusion_feline','syncope','arrhythmia','pulmonary_edema','cyanosis','acute_collapse']),
    ('hepatic_lipidosis', array['anorexia','weight_loss','icteric_mucous_membranes','vomiting','lethargy','ptyalism','hepatic_encephalopathy','elevated_alt','hyperbilirubinemia','dehydration']),
    ('inflammatory_bowel_disease', array['chronic_vomiting','diarrhea','weight_loss','anorexia','lethargy','abdominal_pain','melena','excessive_drooling','hairballs','hypoalbuminemia']),
    ('lymphoma_feline', array['weight_loss','anorexia','vomiting','diarrhea','lymphadenopathy','lethargy','dyspnea','pleural_effusion_feline','anemia_lab','fever']),
    ('toxoplasmosis', array['fever','lethargy','anorexia','dyspnea','uveitis','seizures','ataxia','icteric_mucous_membranes','vomiting','diarrhea']),
    ('ringworm_dermatophytosis', array['alopecia','scaling','crusting','erythema','pruritus','skin_lesions','nodules','recent_shelter_exposure','grooming_decrease','hyperpigmentation']),
    ('asthma_feline', array['coughing','wheezing','dyspnea','tachypnea','open_mouth_breathing_feline','cyanosis','exercise_intolerance','lethargy','anorexia','pleural_effusion_feline']),
    ('upper_respiratory_infection', array['sneezing','nasal_discharge_clear','nasal_discharge_purulent','ocular_discharge','conjunctivitis','fever','anorexia','lethargy','coughing','oral_ulcers']),
    ('dental_disease', array['oral_pain','excessive_drooling','anorexia','weight_loss','resorptive_lesions','bleeding_gums','grooming_decrease','lethargy','fever','abscess']),
    ('obesity_feline', array['weight_gain','lethargy','exercise_intolerance','grooming_decrease','hyperglycemia','dyspnea','plantigrade_stance','constipation','inappropriate_urination','haircoat_poor']),
    ('urinary_obstruction', array['urethral_obstruction','anuria','stranguria','vocalizing_in_litterbox','hematuria','lethargy','vomiting','acute_collapse','electrolyte_abnormality','bradycardia']),
    ('constipation_megacolon', array['constipation','abdominal_pain','anorexia','vomiting','lethargy','dehydration','weight_loss','bloating','melena','excessive_drooling']),
    ('anemia_feline', array['pale_mucous_membranes','lethargy','tachycardia','weak_pulse','dyspnea','pcv_low','anemia_lab','regenerative_anemia','icteric_mucous_membranes','acute_collapse']),
    ('hypocalcemia', array['tremors','seizures','muscle_weakness','ataxia','tachycardia','altered_mentation','electrolyte_abnormality','hypothermia','lethargy','weak_pulse']),
    ('pleural_effusion', array['dyspnea','tachypnea','open_mouth_breathing_feline','cyanosis','pleural_effusion_feline','lethargy','anorexia','weak_pulse','coughing','heart_murmur'])
),
expanded as (
    select
        symptom.id as symptom_id,
        disease.id as disease_id,
        case
            when symptom_order.ordinality <= 3 then 0.78
            when symptom_order.ordinality <= 7 then 0.55
            else 0.30
        end as weight,
        case
            when symptom_order.ordinality <= 7 then 'clinical_consensus'
            else 'conservative_estimate'
        end as evidence_level
    from disease_symptom_seed seed
    join public.vet_disease_nodes disease on disease.label = seed.label
    cross join lateral unnest(seed.symptoms) with ordinality as symptom_order(label, ordinality)
    join public.vet_symptom_nodes symptom on symptom.label = symptom_order.label
)
insert into public.vet_graph_edges (symptom_id, disease_id, weight, evidence_level, graph_version)
select symptom_id, disease_id, weight, evidence_level, 1
from expanded
on conflict do nothing;
